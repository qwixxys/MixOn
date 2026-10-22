import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dbStore, openDatabase } from '../src/db/index.js';
import { createProviders } from '../src/providers/index.js';
import { SoundCloudProvider } from '../src/providers/soundcloud.js';
import {
  findClientId,
  findScripts,
  pickTranscoding,
  SoundCloudWebProvider,
  type ScWebTrack,
} from '../src/providers/soundcloudWeb.js';
import { fakeFetch, testConfig } from './helpers.js';

const ID_A = 'A'.repeat(32);
const ID_B = 'b1'.repeat(16);

const page = (scripts: string[]) =>
  new Response(`<!doctype html><html><body>${scripts.map((s) => `<script crossorigin src="${s}"></script>`).join('')}</body></html>`);
const js = (body: string) => new Response(body, { headers: { 'content-type': 'application/javascript' } });

const transcoding = (protocol: string, mime: string, extra: Record<string, unknown> = {}) => ({
  url: `https://api-v2.soundcloud.com/media/soundcloud:tracks:1/x/stream/${protocol}`,
  preset: 'p',
  snipped: false,
  format: { protocol, mime_type: mime },
  ...extra,
});

const webTrack = (id: number, overrides: Partial<ScWebTrack> = {}): ScWebTrack => ({
  id,
  urn: `soundcloud:tracks:${id}`,
  title: `Трек ${id}`,
  user: { id: 7, urn: 'soundcloud:users:7', username: 'producer' },
  duration: 120_000,
  permalink_url: `https://soundcloud.com/producer/t-${id}`,
  created_at: '2026-10-01T10:00:00Z',
  genre: 'Ambient',
  streamable: true,
  policy: 'ALLOW',
  track_authorization: `auth-${id}`,
  media: { transcodings: [transcoding('hls', 'audio/mp4; codecs="mp4a.40.2"'), transcoding('progressive', 'audio/mpeg')] },
  ...overrides,
});

/** soundcloud.com with two bundles, the client_id in the last one, plus api-v2 routes. */
function site(api: Parameters<typeof fakeFetch>[0], clientId = ID_A) {
  return fakeFetch([
    ['https://soundcloud.com/', () => page(['https://a-v2.sndcdn.com/assets/0-aaa.js', 'https://evil.example/x.js', 'https://a-v2.sndcdn.com/assets/49-bbb.js'])],
    ['a-v2.sndcdn.com/assets/0-aaa.js', () => js('var nothing = 1;')],
    ['a-v2.sndcdn.com/assets/49-bbb.js', () => js(`({client_id:"${clientId}",env:"production"})`)],
    ...api,
  ]);
}

describe('SoundCloud web mode helpers', () => {
  it('finds bundles on the asset host only and the client_id inside them', () => {
    assert.deepEqual(findScripts('<script src="https://a-v2.sndcdn.com/assets/1.js"></script><script src="http://a-v2.sndcdn.com/2.js"></script><script src="https://cdn.other/3.js"></script>'), [
      'https://a-v2.sndcdn.com/assets/1.js',
    ]);
    assert.equal(findClientId(`a={client_id:"${ID_A}"}`), ID_A);
    assert.equal(findClientId(`e.client_id="${ID_B}"`), ID_B);
    assert.equal(findClientId('client_id:"short"'), null);
  });

  it('prefers full progressive MP3, then HLS, and never encrypted or Opus streams', () => {
    const mp3 = transcoding('progressive', 'audio/mpeg');
    const aac = transcoding('hls', 'audio/mp4; codecs="mp4a.40.2"');
    const opus = transcoding('hls', 'audio/ogg; codecs="opus"');
    const drm = transcoding('ctr-encrypted-hls', 'audio/mpeg');
    const snip = transcoding('progressive', 'audio/mpeg', { snipped: true });
    assert.equal(pickTranscoding([aac, mp3]), mp3);
    assert.equal(pickTranscoding([snip, aac]), aac);
    assert.equal(pickTranscoding([drm, opus]), null);
    assert.equal(pickTranscoding([drm, snip]), snip);
    assert.equal(pickTranscoding(undefined), null);
  });
});

describe('SoundCloud web provider', () => {
  it('looks the client_id up once, keeps it and sends it with requests', async () => {
    const store = dbStore(openDatabase(':memory:'));
    const { impl, calls } = site([
      ['api-v2.soundcloud.com/search/users', { collection: [{ id: 7, urn: 'soundcloud:users:7', username: 'producer', followers_count: 2000 }] }],
    ]);
    const provider = new SoundCloudWebProvider({ store, intervalMs: 0 }, impl);
    const [artist] = await provider.searchArtists('producer');
    await provider.searchArtists('again');
    assert.equal(artist.externalId, 'soundcloud:users:7');
    assert.equal(calls.filter((c) => c.url === 'https://soundcloud.com/').length, 1);
    assert.ok(!calls.some((c) => c.url.includes('evil.example')), 'only SoundCloud bundles are read');
    const api = calls.filter((c) => c.url.includes('api-v2'));
    assert.equal(new URL(api[0].url).searchParams.get('client_id'), ID_A);

    // A new instance reuses the saved id without reading the site again.
    const second = site([['api-v2.soundcloud.com/search/users', { collection: [] }]]);
    await new SoundCloudWebProvider({ store, intervalMs: 0 }, second.impl).searchArtists('x');
    assert.deepEqual(second.calls.map((c) => new URL(c.url).hostname), ['api-v2.soundcloud.com']);
  });

  it('looks the client_id up again when SoundCloud rejects it', async () => {
    let bundle = 'old';
    const { impl, calls } = fakeFetch([
      ['https://soundcloud.com/', () => page(['https://a-v2.sndcdn.com/assets/1.js'])],
      ['a-v2.sndcdn.com', () => js(`client_id:"${bundle === 'old' ? ID_A : ID_B}"`)],
      [
        'api-v2.soundcloud.com',
        (url: string) =>
          new URL(url).searchParams.get('client_id') === ID_A
            ? new Response('{}', { status: 401 })
            : new Response(JSON.stringify({ collection: [] })),
      ],
    ]);
    const provider = new SoundCloudWebProvider({ intervalMs: 0 }, (url, init) => {
      if (url.includes('api-v2')) bundle = 'new';
      return impl(url, init);
    });
    assert.deepEqual(await provider.searchArtists('x'), []);
    assert.equal(calls.filter((c) => c.url === 'https://soundcloud.com/').length, 2);
    assert.equal(new URL(calls.at(-1)!.url).searchParams.get('client_id'), ID_B);
  });

  it('explains when the client_id cannot be found', async () => {
    const { impl } = fakeFetch([
      ['https://soundcloud.com/', () => page(['https://a-v2.sndcdn.com/assets/1.js'])],
      ['a-v2.sndcdn.com', () => js('nothing here')],
    ]);
    await assert.rejects(new SoundCloudWebProvider({ intervalMs: 0 }, impl).searchArtists('x'), /client_id/);
  });

  it('reads artist uploads, marks snippets and drops blocked or unplayable tracks', async () => {
    const { impl, calls } = site([
      [
        'api-v2.soundcloud.com/users/7/tracks',
        {
          collection: [
            webTrack(1),
            webTrack(2, { policy: 'BLOCK' }),
            webTrack(3, { policy: 'SNIP', duration: 30_000, full_duration: 200_000 }),
            webTrack(4, { media: { transcodings: [transcoding('ctr-encrypted-hls', 'audio/mp4')] } }),
            webTrack(5, { streamable: false }),
          ],
        },
      ],
    ]);
    const tracks = await new SoundCloudWebProvider({ intervalMs: 0 }, impl).getArtistTracks({ externalId: 'soundcloud:users:7', name: 'producer' });
    assert.match(calls.at(-1)!.url, /\/users\/7\/tracks\?limit=50&client_id=/);
    assert.deepEqual(
      tracks.map((t) => [t.externalId, t.isPreview]),
      [
        ['soundcloud:tracks:1', false],
        ['soundcloud:tracks:3', true],
      ],
    );
    assert.equal(tracks[0].releasedAt, '2026-10-01T10:00:00.000Z');
    assert.equal(tracks[0].duration, 120);
    assert.equal(tracks[1].duration, 200, 'snippets report the whole track length');
  });

  it('resolves a fresh signed stream with the track authorization', async () => {
    const { impl, calls } = site([
      ['api-v2.soundcloud.com/tracks/1?', webTrack(1)],
      ['/stream/progressive', { url: 'https://cf-media.sndcdn.com/abc.128.mp3?Policy=x' }],
    ]);
    const source = await new SoundCloudWebProvider({ intervalMs: 0 }, impl).resolveStream({ externalId: 'soundcloud:tracks:1', streamUrl: null, extra: null });
    assert.deepEqual(source, { url: 'https://cf-media.sndcdn.com/abc.128.mp3?Policy=x', kind: 'direct' });
    const stream = new URL(calls.at(-1)!.url);
    assert.equal(stream.searchParams.get('track_authorization'), 'auth-1');
    assert.equal(stream.searchParams.get('client_id'), ID_A);
  });

  it('plays HLS when there is no progressive stream', async () => {
    const { impl } = site([
      ['api-v2.soundcloud.com/tracks/1?', webTrack(1, { media: { transcodings: [transcoding('hls', 'audio/mp4; codecs="mp4a.40.2"')] } })],
      ['/stream/hls', { url: 'https://playback.media-streaming.soundcloud.cloud/x/playlist.m3u8' }],
    ]);
    const source = await new SoundCloudWebProvider({ intervalMs: 0 }, impl).resolveStream({ externalId: 'soundcloud:tracks:1', streamUrl: null, extra: null });
    assert.equal(source?.kind, 'hls');
  });

  it('falls back to the next stream when one is missing', async () => {
    const { impl } = site([
      ['api-v2.soundcloud.com/tracks/1?', webTrack(1)],
      ['/stream/progressive', { error: 'gone' }, 404],
      ['/stream/hls', { url: 'https://playback.media-streaming.soundcloud.cloud/x/playlist.m3u8' }],
    ]);
    const source = await new SoundCloudWebProvider({ intervalMs: 0 }, impl).resolveStream({ externalId: 'soundcloud:tracks:1', streamUrl: null, extra: null });
    assert.equal(source?.kind, 'hls');
  });

  it('puts adaptive presets last', () => {
    const abr = transcoding('hls', 'audio/mp4', { preset: 'abr_sq' });
    const aac = transcoding('hls', 'audio/mp4', { preset: 'aac_160k' });
    assert.equal(pickTranscoding([abr, aac]), aac);
    assert.equal(pickTranscoding([abr]), abr);
  });

  it('never sends the client_id to hosts other than api-v2', async () => {
    const { impl, calls } = site([
      ['api-v2.soundcloud.com/tracks/1?', webTrack(1, { media: { transcodings: [{ ...transcoding('progressive', 'audio/mpeg'), url: 'https://evil.example/steal' }] } })],
    ]);
    await assert.rejects(
      new SoundCloudWebProvider({ intervalMs: 0 }, impl).resolveStream({ externalId: 'soundcloud:tracks:1', streamUrl: null, extra: null }),
      /неожиданную ссылку/,
    );
    assert.ok(!calls.some((c) => c.url.includes('evil.example')));
  });

  it('imports a playlist, filling in stub tracks in order', async () => {
    const stubs = Array.from({ length: 60 }, (_, i) => ({ id: i + 3 }));
    const { impl, calls } = site([
      [
        'api-v2.soundcloud.com/resolve',
        { kind: 'playlist', id: 9, title: 'Сет', description: 'Описание', permalink_url: 'https://soundcloud.com/producer/sets/set', track_count: 62, tracks: [webTrack(1), webTrack(2), ...stubs] },
      ],
      [
        'api-v2.soundcloud.com/tracks?ids=',
        (url: string) => (new URL(url).searchParams.get('ids') ?? '').split(',').reverse().map((id) => webTrack(Number(id))),
      ],
    ]);
    const playlist = await new SoundCloudWebProvider({ intervalMs: 0 }, impl).importPlaylist(new URL('https://soundcloud.com/producer/sets/set/'));
    const hydrations = calls.filter((c) => c.url.includes('/tracks?ids='));
    assert.equal(hydrations.length, 2, '60 stubs → batches of 50 and 10');
    assert.equal(playlist.tracks.length, 62);
    assert.deepEqual(
      playlist.tracks.slice(0, 4).map((t) => t.externalId),
      ['soundcloud:tracks:1', 'soundcloud:tracks:2', 'soundcloud:tracks:3', 'soundcloud:tracks:4'],
    );
    assert.equal(playlist.url, 'https://soundcloud.com/producer/sets/set');
  });
});

describe('SoundCloud mode selection', () => {
  const soundcloud = (overrides: Partial<ReturnType<typeof testConfig>['soundcloud']>) => {
    const config = testConfig();
    config.soundcloud = { ...config.soundcloud, ...overrides };
    return createProviders(config).get('soundcloud');
  };

  it('uses the official API unless the keyless mode is turned on', () => {
    assert.ok(soundcloud({}) instanceof SoundCloudProvider);
    assert.ok(soundcloud({ publicClient: true }) instanceof SoundCloudWebProvider);
    assert.ok(soundcloud({ publicClient: true, clientId: 'id', clientSecret: 'secret' }) instanceof SoundCloudProvider);
  });
});
