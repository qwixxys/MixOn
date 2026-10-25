import { ProviderError, RateLimiter, type FetchLike, type RequestLane } from '../lib/http.js';
import type { ExternalArtist, ExternalTrack } from './types.js';

/**
 * YouTube Music without a key: the internal API its own web player uses (music.youtube.com/youtubei/v1), the way
 * rootscripts/riff searches it. Only lists are read here — which songs there are, by whom, how long; the songs still
 * play in YouTube's embedded player, and nothing is downloaded. YouTube does not allow this use and may change or
 * block it at any time; an API key (youtube.ts) is the official way.
 */

const BASE = 'https://music.youtube.com/youtubei/v1';
/** The web player as it introduces itself; English, so the labels in its answers ("Song", "subscribers") are known. */
const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en' };
/** Search filters, as the site's own chips. */
const SONGS = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';
const ARTISTS = 'EgWKAQIgAWoMEA4QChADEAQQCRAF';
const HEADERS = {
  'content-type': 'application/json',
  origin: 'https://music.youtube.com',
  referer: 'https://music.youtube.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

interface Run {
  text?: string;
  navigationEndpoint?: { watchEndpoint?: { videoId?: string } };
}

interface Text {
  runs?: Run[];
  simpleText?: string;
}

interface Thumbnails {
  thumbnails?: { url: string }[];
}

/** A row of a list: a song in search results, on an artist's page or in a playlist, or an artist in search results. */
export interface Row {
  flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: { text?: Text } }[];
  fixedColumns?: { musicResponsiveListItemFixedColumnRenderer?: { text?: Text } }[];
  playlistItemData?: { videoId?: string };
  overlay?: {
    musicItemThumbnailOverlayRenderer?: { content?: { musicPlayButtonRenderer?: { playNavigationEndpoint?: { watchEndpoint?: { videoId?: string } } } } };
  };
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: Thumbnails } };
  navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
  /** Greyed out: no longer playable. */
  musicItemRendererDisplayPolicy?: string;
}

interface Header {
  title?: Text;
  secondSubtitle?: Text;
}

/**
 * Every `key` object anywhere in an answer, in order. The layout around rows changes more often than the rows
 * themselves, so they are looked for wherever they are.
 */
function collect<T>(node: unknown, key: string, out: T[] = []): T[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v as T);
      else collect(v, key, out);
    }
  }
  return out;
}

const text = (t: Text | undefined) => (t?.runs ?? []).map((r) => r.text ?? '').join('').trim() || t?.simpleText?.trim() || '';
const column = (row: Row, i: number) => row.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text;

/** "Song • Artist • Album • 3:21" as its parts. */
function parts(t: Text | undefined): string[] {
  const out: string[] = [];
  let current = '';
  for (const run of t?.runs ?? []) {
    if (run.text?.trim() === '•') {
      out.push(current.trim());
      current = '';
    } else current += run.text ?? '';
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

/** "3:21" or "1:02:03" → seconds; 0 for anything else. */
export function clockSeconds(value: string | undefined): number {
  if (!value || !/^\d+(:\d{1,2}){1,2}$/.test(value.trim())) return 0;
  return value
    .trim()
    .split(':')
    .reduce((total, n) => total * 60 + Number(n), 0);
}

/** "1.23M subscribers" → 1230000. */
export function subscriberCount(value: string): number {
  const m = value.match(/([\d.,]+)\s*([KMB])?\s+subscribers?/i);
  if (!m) return 0;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(Number(m[1].replace(/,/g, '')) * scale);
}

function cover(row: Row): string | null {
  const list = row.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
  const url = list.at(-1)?.url;
  // Covers come small with their size in the address; a bigger one is the same address with another size.
  return url ? url.replace(/=w\d+-h\d+[^&/]*$/, '=w544-h544-l90-rj') : null;
}

/** Brackets that describe the video rather than the song: "(Official Video)", "[Lyric Video]", "(4K)"… */
export const VIDEO_NOISE = /\s*[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|mv|m\/v|hd|hq|4k|clip|клип)\b[^)\]]*[)\]]/gi;

/** What a row is when it says so: songs and music videos are kept, podcast episodes are not. */
const KIND = /^(song|video|episode|podcast)$/i;
const PLAYS = /\b(plays|views)$/i;

/** A song row as a track; null for rows that are not a playable song. */
export function rowTrack(row: Row): ExternalTrack | null {
  if (row.musicItemRendererDisplayPolicy === 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT') return null;
  const videoId =
    row.playlistItemData?.videoId ??
    row.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ??
    column(row, 0)?.runs?.find((r) => r.navigationEndpoint?.watchEndpoint?.videoId)?.navigationEndpoint?.watchEndpoint?.videoId;
  const shown = text(column(row, 0));
  // Music videos carry "(Official Video)" and the like in their titles; the song is the rest.
  const title = shown.replace(VIDEO_NOISE, '').trim() || shown;
  if (!videoId || !/^[\w-]{11}$/.test(videoId) || !title) return null;
  // Search results: "Song • Artist • Album • 3:21"; artist pages and playlists: the artists here, the rest beside.
  const info = parts(column(row, 1));
  if (info.some((p) => /^(episode|podcast)$/i.test(p))) return null;
  const details = info.filter((p) => !KIND.test(p) && !PLAYS.test(p));
  let duration = clockSeconds(text(row.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text));
  if (!duration && clockSeconds(details.at(-1))) duration = clockSeconds(details.pop());
  // Playlists put the album in the third column; artist pages put the play count there and the album after it.
  const beside = [text(column(row, 2)), text(column(row, 3))].find((x) => x && !PLAYS.test(x));
  return {
    externalId: videoId,
    title,
    artist: (details[0] ?? '').replace(/\s+-\s+Topic$/i, '').trim() || 'YouTube',
    album: details[1] ?? beside ?? null,
    duration,
    streamUrl: null,
    coverUrl: cover(row) ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    externalUrl: `https://music.youtube.com/watch?v=${videoId}`,
    releasedAt: null,
    genre: null,
    isPreview: false,
  };
}

/** An artist row of a search; `label` turns a subscriber count into the subtitle. */
export function rowArtist(row: Row, label: (subscribers: number) => string | null): ExternalArtist | null {
  const id = row.navigationEndpoint?.browseEndpoint?.browseId;
  const name = text(column(row, 0));
  if (!id?.startsWith('UC') || !name) return null;
  const subscribers = parts(column(row, 1)).map(subscriberCount).find((n) => n > 0);
  return {
    externalId: id,
    name,
    imageUrl: cover(row),
    url: `https://music.youtube.com/channel/${id}`,
    subtitle: subscribers ? label(subscribers) : null,
  };
}

const unique = <T extends { externalId: string }>(items: (T | null)[]) => {
  const seen = new Set<string>();
  return items.filter((x): x is T => x !== null && !seen.has(x.externalId) && Boolean(seen.add(x.externalId)));
};

/** Where the next page of a list is: the newer continuation command, or the older continuation data. */
function nextPage(node: unknown): { token: string; old: boolean } | null {
  const command = collect<{ continuationEndpoint?: { continuationCommand?: { token?: string } } }>(node, 'continuationItemRenderer')
    .map((c) => c.continuationEndpoint?.continuationCommand?.token)
    .find(Boolean);
  if (command) return { token: command, old: false };
  const data = collect<{ continuation?: string }>(node, 'nextContinuationData')
    .map((c) => c.continuation)
    .find(Boolean);
  return data ? { token: data, old: true } : null;
}

export class YouTubeMusicWeb {
  private limiter = new RateLimiter(300);

  constructor(private fetchImpl: FetchLike) {}

  private async call(endpoint: 'search' | 'browse', body: object, lane: RequestLane = 'normal', query = ''): Promise<unknown> {
    await this.limiter.wait(lane);
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}/${endpoint}?prettyPrint=false${query}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ context: { client: CLIENT }, ...body }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderError('youtube', `Сервис недоступен: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ProviderError('youtube', `YouTube ответил ошибкой HTTP ${res.status}`, res.status);
    try {
      return await res.json();
    } catch {
      throw new ProviderError('youtube', `YouTube ответил ошибкой HTTP ${res.status}`, res.status);
    }
  }

  /** Songs for a query, as the site's «Songs» filter finds them. */
  async songs(query: string, lane: RequestLane = 'normal'): Promise<ExternalTrack[]> {
    const reply = await this.call('search', { query, params: SONGS }, lane);
    return unique(collect<Row>(reply, 'musicResponsiveListItemRenderer').map(rowTrack));
  }

  async artists(query: string, label: (subscribers: number) => string | null): Promise<ExternalArtist[]> {
    const reply = await this.call('search', { query, params: ARTISTS });
    return unique(collect<Row>(reply, 'musicResponsiveListItemRenderer').map((row) => rowArtist(row, label)));
  }

  /** The songs on an artist's page (its most played ones). */
  async artistSongs(channelId: string): Promise<ExternalTrack[]> {
    const reply = await this.call('browse', { browseId: channelId });
    return unique(collect<Row>(reply, 'musicResponsiveListItemRenderer').map(rowTrack));
  }

  /** A public playlist or album, page by page, up to `max` songs read. */
  async playlist(id: string, max: number): Promise<{ title: string; tracks: ExternalTrack[]; total: number; fetched: number }> {
    const first = await this.call('browse', { browseId: `VL${id}` });
    const header = ['musicResponsiveHeaderRenderer', 'musicDetailHeaderRenderer', 'musicImmersiveHeaderRenderer']
      .flatMap((key) => collect<Header>(first, key))
      .find((h) => text(h.title));
    // The playlist's own list, not the suggestions under it.
    const shelf = collect<unknown>(first, 'musicPlaylistShelfRenderer')[0] ?? first;
    const rows = collect<Row>(shelf, 'musicResponsiveListItemRenderer');
    if (!header && !rows.length) throw new ProviderError('youtube', 'YouTube: плейлист не найден или скрыт', 404);

    let page = nextPage(shelf);
    for (let guard = 0; page && rows.length < max && guard < 50; guard++) {
      const more = page.old
        ? await this.call('browse', {}, 'normal', `&ctoken=${encodeURIComponent(page.token)}&continuation=${encodeURIComponent(page.token)}&type=next`)
        : await this.call('browse', { continuation: page.token });
      const added = collect<Row>(more, 'musicResponsiveListItemRenderer');
      if (!added.length) break;
      rows.push(...added);
      page = nextPage(more);
    }

    const read = rows.slice(0, max);
    const listed = Number(text(header?.secondSubtitle).match(/([\d,]+)\s+(songs|tracks|videos)/i)?.[1]?.replace(/,/g, ''));
    return {
      title: text(header?.title) || 'YouTube',
      tracks: unique(read.map(rowTrack)),
      total: Math.max(listed || 0, rows.length),
      fetched: read.length,
    };
  }
}
