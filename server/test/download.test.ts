import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { demuxTs, downloadAudio, parseMediaPlaylist, sniffAudioType } from '../src/lib/download.js';
import { YouTubeProvider } from '../src/providers/youtube.js';
import { createTestApp, FakeProvider, fakeFetch, register, track } from './helpers.js';

/** One 188-byte transport stream packet; short payloads are padded with an adaptation field, as muxers do. */
function tsPacket(pid: number, start: boolean, payload: Uint8Array): Uint8Array {
  const p = new Uint8Array(188).fill(0xff);
  p[0] = 0x47;
  p[1] = (start ? 0x40 : 0) | ((pid >> 8) & 0x1f);
  p[2] = pid & 0xff;
  if (payload.length >= 184) {
    p[3] = 0x10;
    p.set(payload.subarray(0, 184), 4);
  } else {
    const stuffing = 183 - payload.length;
    p[3] = 0x30;
    p[4] = stuffing;
    if (stuffing > 0) p[5] = 0;
    p.set(payload, 5 + stuffing);
  }
  return p;
}

const PAT = Uint8Array.from([0, 0x00, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe1, 0x00, 1, 2, 3, 4]);
const PMT = Uint8Array.from([0, 0x02, 0xb0, 18, 0, 1, 0xc1, 0, 0, 0xe1, 0x01, 0xf0, 0, 0x03, 0xe1, 0x01, 0xf0, 0, 1, 2, 3, 4]);

/** A segment carrying `audio` in one PES packet on PID 0x101, after the PAT and PMT. */
function tsSegment(audio: Uint8Array): Uint8Array {
  const pes = new Uint8Array(14 + audio.length);
  pes.set([0, 0, 1, 0xc0, 0, 0, 0x80, 0x80, 5, 0x21, 0, 1, 0, 1]);
  pes.set(audio, 14);
  const packets = [tsPacket(0, true, PAT), tsPacket(0x100, true, PMT)];
  for (let at = 0; at < pes.length; at += 184) packets.push(tsPacket(0x101, at === 0, pes.subarray(at, at + 184)));
  const out = new Uint8Array(packets.length * 188);
  packets.forEach((p, i) => out.set(p, i * 188));
  return out;
}

const mp3Frames = (seed: number, length: number) => Uint8Array.from({ length }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xfb : (seed + i) % 251));

async function encrypt(data: Uint8Array, key: Uint8Array, sequence: number) {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, sequence);
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, data));
}

const bytesResponse = (bytes: Uint8Array, type = 'application/octet-stream') => () => new Response(bytes, { headers: { 'content-type': type } });

describe('saving tracks for offline listening', () => {
  it('recognises audio files', () => {
    assert.equal(sniffAudioType(Uint8Array.from([0x49, 0x44, 0x33]), 'application/octet-stream'), 'audio/mpeg');
    assert.equal(sniffAudioType(Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]), null), 'audio/mp4');
    assert.equal(sniffAudioType(Uint8Array.from([0xff, 0xf1]), null), 'audio/aac');
    assert.equal(sniffAudioType(new Uint8Array(4), 'audio/x-m4a; charset=binary'), 'audio/x-m4a');
  });

  it('reads media playlists with keys, init segments and sequence numbers', () => {
    const list = parseMediaPlaylist(
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="k.bin",IV=0x0102\n#EXTINF:4,\na.m4s\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\nhttps://other.example/b.m4s\n',
      'https://cdn.example/x/index.m3u8',
    );
    assert.equal(list.init, 'https://cdn.example/x/init.mp4');
    assert.deepEqual(
      list.segments.map((s) => [s.url, s.sequence, s.key?.url ?? null]),
      [
        ['https://cdn.example/x/a.m4s', 7, 'https://cdn.example/x/k.bin'],
        ['https://other.example/b.m4s', 8, null],
      ],
    );
    assert.equal(list.segments[0].key?.iv?.[15], 2);
    assert.throws(() => parseMediaPlaylist('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n', 'https://x.example/'), /защищён/);
    assert.throws(() => parseMediaPlaylist('#EXTINF:4,\nhttp://127.0.0.1:4000/api/x\n', 'https://x.example/'), /небезопасный/);
  });

  it('unpacks audio frames from MPEG-TS', () => {
    const audio = mp3Frames(1, 500);
    const out = demuxTs(tsSegment(audio));
    assert.equal(out.type, 'audio/mpeg');
    assert.deepEqual(out.bytes, audio);
  });

  it('joins an AES-128 encrypted HLS stream into one MP3, picking the best variant', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16));
    const a = mp3Frames(1, 700);
    const b = mp3Frames(2, 300);
    const { impl, calls } = fakeFetch([
      ['cdn.example/master.m3u8', () => new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=192000\nhigh/index.m3u8\n')],
      ['cdn.example/high/index.m3u8', () => new Response('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:3\n#EXT-X-KEY:METHOD=AES-128,URI="key.pub"\n#EXTINF:2,\ns0.ts\n#EXTINF:2,\ns1.ts\n#EXT-X-ENDLIST\n')],
      ['cdn.example/high/key.pub', bytesResponse(key)],
      ['cdn.example/high/s0.ts', bytesResponse(await encrypt(tsSegment(a), key, 3))],
      ['cdn.example/high/s1.ts', bytesResponse(await encrypt(tsSegment(b), key, 4))],
    ]);
    const file = await downloadAudio({ kind: 'hls', url: 'https://cdn.example/master.m3u8' }, { 'user-agent': 'KateMobile' }, impl, 'vk');
    assert.equal(file.type, 'audio/mpeg');
    assert.deepEqual(file.bytes, Uint8Array.from([...a, ...b]));
    assert.ok(!calls.some((c) => c.url.includes('/low/')), 'only the best variant');
    assert.ok(calls.every((c) => (c.init?.headers as Record<string, string>)['user-agent'] === 'KateMobile'), 'service headers on every request');
  });

  it('appends fMP4 segments to their init segment', async () => {
    const { impl } = fakeFetch([
      ['/a.m3u8', () => new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5,\n1.m4s\n#EXTINF:5,\n2.m4s\n')],
      ['/init.mp4', bytesResponse(Uint8Array.from([1, 2]))],
      ['/1.m4s', bytesResponse(Uint8Array.from([3]))],
      ['/2.m4s', bytesResponse(Uint8Array.from([4, 5]))],
    ]);
    const file = await downloadAudio({ kind: 'hls', url: 'https://cdn.example/a.m3u8' }, {}, impl, 'soundcloud');
    assert.deepEqual([...file.bytes], [1, 2, 3, 4, 5]);
    assert.equal(file.type, 'audio/mp4');
  });

  describe('through the API', () => {
    const audio = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3]);
    let fail = 0;
    const { impl } = fakeFetch([
      [
        'cdn.example/',
        () => (fail-- > 0 ? new Response('expired', { status: 403 }) : new Response(audio, { headers: { 'content-type': 'binary/octet-stream' } })),
      ],
    ]);
    class Resolving extends FakeProvider {
      resolved = 0;
      override async resolveStream() {
        this.resolved++;
        return { url: `https://cdn.example/${this.resolved}.mp3`, kind: 'direct' as const };
      }
    }
    const provider = new Resolving();
    const t = createTestApp([provider, new YouTubeProvider('key', impl)], impl);
    after(t.cleanup);
    let user: { auth: Record<string, string> };
    before(async () => {
      user = await register(t.request, 'listener');
    });

    it('sends the whole file, with a fresh link when the old one expired', async () => {
      t.ctx.sync.storeTracks([track('dl1')], provider.id, null);
      const { id } = t.ctx.db.prepare(`SELECT id FROM tracks WHERE external_id = 'dl1'`).get() as { id: number };
      await t.request.get(`/api/tracks/${id}/download`).expect(401);
      fail = 1;
      const res = await t.request.get(`/api/tracks/${id}/download`).set(user.auth).buffer(true).expect(200);
      assert.equal(res.headers['content-type'], 'audio/mpeg');
      assert.deepEqual([...new Uint8Array(res.body)], [...audio]);
    });

    it('refuses YouTube videos', async () => {
      t.ctx.sync.storeTracks([track('ytv', { streamUrl: null })], 'youtube', null);
      const { id } = t.ctx.db.prepare(`SELECT id FROM tracks WHERE external_id = 'ytv'`).get() as { id: number };
      const res = await t.request.get(`/api/tracks/${id}/download`).set(user.auth).expect(403);
      assert.match(res.body.error, /YouTube не разрешает/);
    });
  });
});
