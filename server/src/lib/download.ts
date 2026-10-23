// Puts a track's audio into one file for listening offline in the app: a direct link is fetched as is; an HLS stream
// (VK, SoundCloud) is fetched segment by segment, decrypted when it uses AES-128 and joined into a file a browser can
// play — MPEG-TS segments are unpacked to their MP3/AAC frames, fMP4 segments are appended to their init segment.
import type { StreamSource } from '../providers/types.js';
import { HttpError } from './errors.js';
import { ProviderError, type FetchLike } from './http.js';

/** Largest file a download may produce (about an hour of MP3 at 128 kbit/s), to keep memory in bounds on phones. */
export const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;
const MAX_SEGMENTS = 3000;
const PARALLEL = 4;
const TIMEOUT_MS = 60_000;

export interface AudioFile {
  bytes: Uint8Array;
  type: string;
}

const tooBig = () => new HttpError(413, 'Трек слишком длинный, чтобы сохранить его на устройстве');

async function fetchBytes(fetchImpl: FetchLike, provider: string, url: string, headers: Record<string, string>) {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderError(provider, `Не удалось скачать аудио: ${(err as Error).message}`);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new ProviderError(provider, `Сервис не отдал аудио (HTTP ${res.status})`, res.status);
  }
  if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) throw tooBig();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw tooBig();
  return { bytes, type: res.headers.get('content-type') };
}

const startsWith = (b: Uint8Array, text: string, at = 0) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
const isAdts = (b: Uint8Array, i = 0) => b[i] === 0xff && (b[i + 1] & 0xf6) === 0xf0;
const isMpegAudio = (b: Uint8Array, i = 0) => b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0 && (b[i + 1] & 0x06) !== 0;
const isTs = (b: Uint8Array) => b[0] === 0x47 && (b.length < 189 || b[188] === 0x47);

/** The audio type of a file, from its first bytes when the server's Content-Type says nothing useful. */
export function sniffAudioType(bytes: Uint8Array, declared: string | null): string {
  const type = declared?.split(';')[0].trim().toLowerCase();
  if (type?.startsWith('audio/')) return type === 'audio/mp3' ? 'audio/mpeg' : type;
  if (startsWith(bytes, 'ID3') || isMpegAudio(bytes)) return isAdts(bytes) ? 'audio/aac' : 'audio/mpeg';
  if (isAdts(bytes)) return 'audio/aac';
  if (startsWith(bytes, 'ftyp', 4)) return 'audio/mp4';
  if (startsWith(bytes, 'OggS')) return 'audio/ogg';
  if (startsWith(bytes, 'fLaC')) return 'audio/flac';
  if (startsWith(bytes, 'RIFF')) return 'audio/wav';
  return 'audio/mpeg';
}

// ---------- HLS ----------

interface Segment {
  url: string;
  sequence: number;
  key: { url: string; iv: Uint8Array<ArrayBuffer> | null } | null;
}

interface MediaPlaylist {
  segments: Segment[];
  init: string | null;
}

/** An address from a playlist; only https, so a playlist cannot point the server at local or internal hosts. */
function resolve(uri: string, base: string): string {
  const url = new URL(uri, base);
  if (url.protocol !== 'https:') throw new HttpError(422, 'Поток ссылается на небезопасный адрес, скачать его нельзя');
  return url.toString();
}

function attributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.replace(/^0x/i, '').padStart(32, '0');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(clean.slice(i * 2, i * 2 + 2), 16));
}

/** The variant to download from a master playlist (the best bandwidth), or null for a media playlist. */
function pickVariant(text: string, base: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let best: { url: string; bandwidth: number } | null = null;
  lines.forEach((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF')) return;
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    const bandwidth = Number(attributes(line).BANDWIDTH) || 0;
    if (uri && (!best || bandwidth > best.bandwidth)) best = { url: resolve(uri, base), bandwidth };
  });
  return (best as { url: string } | null)?.url ?? null;
}

export function parseMediaPlaylist(text: string, base: string): MediaPlaylist {
  const segments: Segment[] = [];
  let sequence = 0;
  let key: Segment['key'] = null;
  let init: string | null = null;
  let expectUri = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-KEY:')) {
      const a = attributes(line);
      if (a.METHOD === 'NONE') key = null;
      else if (a.METHOD === 'AES-128' && a.URI) key = { url: resolve(a.URI, base), iv: a.IV ? hexBytes(a.IV) : null };
      else throw new HttpError(422, 'Этот поток защищён, скачать его нельзя');
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = attributes(line).URI;
      if (uri) init = resolve(uri, base);
    } else if (line.startsWith('#EXTINF')) expectUri = true;
    else if (!line.startsWith('#') && expectUri) {
      segments.push({ url: resolve(line, base), sequence: sequence++, key });
      expectUri = false;
    }
  }
  return { segments, init };
}

type Bytes = Uint8Array<ArrayBuffer>;

async function decrypt(data: Bytes, rawKey: Bytes, iv: Bytes): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data));
}

/** The 16-byte IV HLS uses when the playlist gives none: the segment's sequence number, big-endian. */
function sequenceIv(sequence: number): Bytes {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, sequence);
  return iv;
}

/** Runs `work` over `items` with a few at a time, keeping the results in order. */
async function inOrder<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]);
      }
    }),
  );
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (total > MAX_DOWNLOAD_BYTES) throw tooBig();
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Where a PSI table's entries end: before its 4-byte CRC, and within the packet. */
const sectionBodyEnd = (t: Uint8Array) => Math.min(t.length, 3 + (((t[1] & 0x0f) << 8) | t[2])) - 4;

/**
 * The audio frames of an MPEG transport stream: the payload of the first audio stream its programme lists (MP3 or
 * AAC with ADTS headers), which browsers play as a plain .mp3/.aac file.
 */
export function demuxTs(ts: Uint8Array): AudioFile {
  const packets = Math.floor(ts.length / 188);
  let pmtPid = -1;
  let audioPid = -1;
  let type = '';
  const chunks: Uint8Array[] = [];
  let pesHeaderPending = false;

  for (let n = 0; n < packets; n++) {
    const p = n * 188;
    if (ts[p] !== 0x47) continue;
    const start = (ts[p + 1] & 0x40) !== 0;
    const pid = ((ts[p + 1] & 0x1f) << 8) | ts[p + 2];
    const adaptation = (ts[p + 3] >> 4) & 3;
    let offset = p + 4;
    if (adaptation & 2) offset += 1 + ts[p + 4];
    if (!(adaptation & 1) || offset >= p + 188) continue;
    const payload = ts.subarray(offset, p + 188);

    if (pid === 0 && start && pmtPid < 0) {
      // PAT: the first programme's PMT.
      const t = payload.subarray(1 + payload[0]);
      const sectionEnd = sectionBodyEnd(t);
      for (let i = 8; i + 4 <= sectionEnd; i += 4) {
        const program = (t[i] << 8) | t[i + 1];
        if (program !== 0) {
          pmtPid = ((t[i + 2] & 0x1f) << 8) | t[i + 3];
          break;
        }
      }
    } else if (pid === pmtPid && start && audioPid < 0) {
      // PMT: the first MPEG audio (0x03, 0x04) or AAC ADTS (0x0f) stream.
      const t = payload.subarray(1 + payload[0]);
      const sectionEnd = sectionBodyEnd(t);
      let i = 12 + (((t[10] & 0x0f) << 8) | t[11]);
      while (i + 5 <= sectionEnd) {
        const streamType = t[i];
        const esPid = ((t[i + 1] & 0x1f) << 8) | t[i + 2];
        if (streamType === 0x03 || streamType === 0x04 || streamType === 0x0f) {
          audioPid = esPid;
          type = streamType === 0x0f ? 'audio/aac' : 'audio/mpeg';
          break;
        }
        i += 5 + (((t[i + 3] & 0x0f) << 8) | t[i + 4]);
      }
    } else if (pid === audioPid) {
      let data = payload;
      if (start) pesHeaderPending = true;
      if (pesHeaderPending) {
        if (data.length < 9 || data[0] !== 0 || data[1] !== 0 || data[2] !== 1) continue;
        data = data.subarray(9 + data[8]);
        pesHeaderPending = false;
      }
      chunks.push(data);
    }
  }
  if (audioPid < 0 || !chunks.length) throw new HttpError(422, 'В потоке не нашлось звуковой дорожки, которую можно сохранить');
  return { bytes: concat(chunks), type };
}

async function downloadHls(url: string, headers: Record<string, string>, fetchImpl: FetchLike, provider: string): Promise<AudioFile> {
  const text = (u: string) => fetchBytes(fetchImpl, provider, u, headers).then(({ bytes }) => new TextDecoder().decode(bytes));
  let base = url;
  let playlist = await text(base);
  const variant = pickVariant(playlist, base);
  if (variant) {
    base = variant;
    playlist = await text(base);
  }
  const { segments, init } = parseMediaPlaylist(playlist, base);
  if (!segments.length) throw new ProviderError(provider, 'Поток пуст: в плейлисте нет сегментов');
  if (segments.length > MAX_SEGMENTS) throw tooBig();

  const keys = new Map<string, Promise<Bytes>>();
  const keyFor = (u: string) => {
    if (!keys.has(u)) keys.set(u, fetchBytes(fetchImpl, provider, u, headers).then((r) => r.bytes));
    return keys.get(u)!;
  };
  let total = 0;
  const parts = await inOrder(segments, async (s) => {
    let { bytes } = await fetchBytes(fetchImpl, provider, s.url, headers);
    if (s.key) bytes = await decrypt(bytes, await keyFor(s.key.url), s.key.iv ?? sequenceIv(s.sequence));
    total += bytes.length;
    if (total > MAX_DOWNLOAD_BYTES) throw tooBig();
    return bytes;
  });

  if (init) {
    const head = (await fetchBytes(fetchImpl, provider, init, headers)).bytes;
    return { bytes: concat([head, ...parts]), type: 'audio/mp4' };
  }
  const joined = concat(parts);
  return isTs(joined) ? demuxTs(joined) : { bytes: joined, type: sniffAudioType(joined, null) };
}

/** The whole audio of a track as one file, from the source the player would use. */
export async function downloadAudio(
  source: StreamSource,
  headers: Record<string, string>,
  fetchImpl: FetchLike,
  provider: string,
): Promise<AudioFile> {
  if (source.kind === 'youtube') {
    throw new HttpError(403, 'YouTube не разрешает скачивать видео: такие треки играют только онлайн, во встроенном плеере YouTube');
  }
  if (source.kind === 'hls') return downloadHls(source.url, headers, fetchImpl, provider);
  const { bytes, type } = await fetchBytes(fetchImpl, provider, source.url, headers);
  return { bytes, type: sniffAudioType(bytes, type) };
}
