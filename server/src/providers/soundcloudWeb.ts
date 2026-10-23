import type { KeyValueStore } from '../db/index.js';
import { ProviderError, RateLimiter, type FetchLike } from '../lib/http.js';
import {
  isScPlaylistUrl,
  mapScTrack,
  mapScUser,
  SC_SHORT_LINK_HOSTS,
  scNumericId,
  type ScTrack,
  type ScUser,
} from './soundcloud.js';
import {
  SEARCH_TRACK_LIMIT,
  type ArtistRef,
  type ExternalArtist,
  type ExternalTrack,
  type ImportedPlaylist,
  type MusicProvider,
  type SearchHits,
  type StoredExternalTrack,
  type StreamSource,
} from './types.js';

/**
 * Unofficial SoundCloud mode: the same internal API (api-v2) that soundcloud.com itself uses, with the public
 * client_id taken from the site's scripts. No keys are needed, but SoundCloud does not support third-party use of
 * this API and can change or block it at any time. It is off unless the server owner turns it on
 * (SOUNDCLOUD_PUBLIC_CLIENT=1), and only used when no official keys are set.
 */

const SITE = 'https://soundcloud.com/';
const API = 'https://api-v2.soundcloud.com';
const API_HOST = 'api-v2.soundcloud.com';
const SCRIPT_HOST = 'a-v2.sndcdn.com';
const CLIENT_ID_KEY = 'soundcloud.web_client_id';
/** How long a found client_id is trusted before it is looked up again even without errors. */
const CLIENT_ID_TTL_MS = 24 * 3600_000;
/** Scripts checked for the client_id, newest bundles last on the page, so they are read from the end. */
const MAX_SCRIPTS = 8;
/** Stub tracks in a playlist are filled in this many at a time (the batch size other clients use). */
const HYDRATE_BATCH = 50;
const MAX_IMPORT = 1000;
/** soundcloud.com is read again for a new client_id at most this often, however many requests get rejected. */
const RESCRAPE_COOLDOWN_MS = 10 * 60_000;
/**
 * soundcloud.com and its API serve clients that look like its own web player. Without a browser User-Agent (the
 * Android app's HTTP client sends none of its own) the site answers with a page that lacks the scripts the client_id is
 * read from, and the API is quicker to refuse.
 */
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
};
const BLOCKED_MESSAGE =
  'SoundCloud отклонил запрос (HTTP 403): он ограничивает неофициальных клиентов, и с этого сервера режим без ключей может не работать';

interface Transcoding {
  url: string;
  preset?: string;
  snipped?: boolean;
  format?: { protocol?: string; mime_type?: string };
}

export interface ScWebTrack extends ScTrack {
  policy?: 'ALLOW' | 'MONETIZE' | 'SNIP' | 'BLOCK' | string;
  track_authorization?: string;
  media?: { transcodings?: Transcoding[] };
}

interface ScWebPlaylist {
  kind?: string;
  id: number;
  title: string;
  description?: string | null;
  permalink_url?: string;
  track_count?: number;
  tracks?: (Partial<ScWebTrack> & { id: number })[];
}

interface ScWebPage<T> {
  collection: T[];
  next_href?: string | null;
}

export interface SoundCloudWebOptions {
  store?: KeyValueStore;
  /** Minimum gap between requests to SoundCloud, to stay well clear of its rate limits. */
  intervalMs?: number;
}

/** Client_id assignments in SoundCloud's bundles look like `client_id:"<32 chars>"` or `client_id="…"`. */
export function findClientId(js: string): string | null {
  return js.match(/client_id\s*[:=]\s*"([0-9a-zA-Z]{32})"/)?.[1] ?? null;
}

/** Script bundles referenced by the soundcloud.com page, limited to SoundCloud's own asset host. */
export function findScripts(html: string): string[] {
  const urls: string[] = [];
  for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    try {
      const url = new URL(src, SITE);
      if (url.protocol === 'https:' && url.hostname === SCRIPT_HOST) urls.push(url.toString());
    } catch {
      // not a URL
    }
  }
  return urls;
}

const isEncrypted = (t: Transcoding) => !['progressive', 'hls'].includes(t.format?.protocol ?? '');
/** Browsers (and hls.js) cannot play Opus inside HLS; MP3 and AAC work everywhere. */
const isPlayable = (t: Transcoding) => !isEncrypted(t) && !/ogg|opus/i.test(t.format?.mime_type ?? '');
/** Widevine/PlayReady/FairPlay streams. Such tracks also list MP3 streams, but those answer 404. */
const hasDrm = (list: Transcoding[] | undefined) => (list ?? []).some((t) => /^(ctr|cbc)-/.test(t.format?.protocol ?? ''));
const bitrate = (t: Transcoding) => Number(t.preset?.match(/(\d+)k/)?.[1] ?? 0);

/**
 * Streams a browser can play, best first: full over snippet, a plain file over HLS (SoundCloud removed MP3 files in
 * 2026, so it is usually AAC over HLS), higher bitrate first, and the adaptive "abr" presets, which other clients
 * report as broken, last. Encrypted ones are skipped.
 */
export function rankTranscodings(list: Transcoding[] | undefined): Transcoding[] {
  const rank = (t: Transcoding) =>
    (t.snipped ? 10 : 0) + (t.preset?.startsWith('abr') ? 5 : 0) + (t.format?.protocol === 'progressive' ? 0 : 1);
  return (list ?? []).filter(isPlayable).sort((a, b) => rank(a) - rank(b) || bitrate(b) - bitrate(a));
}

export const pickTranscoding = (list: Transcoding[] | undefined): Transcoding | null => rankTranscodings(list)[0] ?? null;

/** Only part of the track can be played: SoundCloud Go tracks outside a subscription. */
function isSnippet(t: ScWebTrack) {
  if (t.policy === 'SNIP') return true;
  const playable = (t.media?.transcodings ?? []).filter(isPlayable);
  return playable.length > 0 && playable.every((x) => x.snipped);
}

function isListenable(t: ScWebTrack) {
  return t.streamable !== false && t.policy !== 'BLOCK' && !hasDrm(t.media?.transcodings) && Boolean(pickTranscoding(t.media?.transcodings));
}

export class SoundCloudWebProvider implements MusicProvider {
  readonly id = 'soundcloud' as const;
  readonly name = 'SoundCloud';
  readonly description =
    'Поиск, плейлисты по ссылке и полное прослушивание без ключей API. Новые треки артистов SoundCloud может не отдавать неофициальным клиентам.';
  readonly requiresToken = false;
  readonly connectMode = null;
  readonly fullTracks = true;
  readonly proxyStreams = false;
  readonly unofficial = true;
  readonly shortLinkHosts = SC_SHORT_LINK_HOSTS;

  private clientId: { id: string; at: number } | null = null;
  private lookup: Promise<string> | null = null;
  private lastRescrape = 0;
  private limiter: RateLimiter;

  constructor(
    private options: SoundCloudWebOptions = {},
    private fetchImpl: FetchLike = fetch,
  ) {
    // SoundCloud starts answering 429 at roughly 600 requests per 10 minutes.
    this.limiter = new RateLimiter(options.intervalMs ?? 500);
    const saved = options.store?.get(CLIENT_ID_KEY);
    if (saved) {
      try {
        this.clientId = JSON.parse(saved);
      } catch {
        // ignore a damaged value; a new id is looked up on first use
      }
    }
  }

  isConfigured() {
    return true;
  }

  private async fetchText(url: string): Promise<string> {
    await this.limiter.wait();
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new ProviderError(this.id, `SoundCloud недоступен: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ProviderError(this.id, `SoundCloud ответил ошибкой HTTP ${res.status}`, res.status);
    return res.text();
  }

  /** Reads the public client_id the soundcloud.com web player uses. Concurrent callers share one lookup. */
  private getClientId(force = false): Promise<string> {
    if (!force && this.clientId && Date.now() - this.clientId.at < CLIENT_ID_TTL_MS) return Promise.resolve(this.clientId.id);
    this.lookup ??= (async () => {
      const scripts = findScripts(await this.fetchText(SITE)).reverse().slice(0, MAX_SCRIPTS);
      for (const src of scripts) {
        const id = findClientId(await this.fetchText(src));
        if (id) {
          this.clientId = { id, at: Date.now() };
          this.options.store?.set(CLIENT_ID_KEY, JSON.stringify(this.clientId));
          return id;
        }
      }
      throw new ProviderError(this.id, 'Не удалось получить client_id с soundcloud.com: сайт изменился или недоступен');
    })().finally(() => {
      this.lookup = null;
    });
    return this.lookup;
  }

  /**
   * GET on api-v2 with the client_id. A rejected id is looked up again once, but not more often than the cooldown:
   * a 403 can also be SoundCloud's bot protection, which a new id does not fix.
   */
  private async get<T>(pathOrUrl: string, retry = true, blocked403 = BLOCKED_MESSAGE): Promise<T> {
    const url = new URL(pathOrUrl, API);
    // Paging links and stream links come from SoundCloud's answers; never send the id anywhere else.
    if (url.protocol !== 'https:' || url.hostname !== API_HOST) throw new ProviderError(this.id, 'SoundCloud вернул неожиданную ссылку');
    url.searchParams.set('client_id', await this.getClientId());

    await this.limiter.wait();
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { ...BROWSER_HEADERS, accept: 'application/json', origin: 'https://soundcloud.com', referer: 'https://soundcloud.com/' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderError(this.id, `SoundCloud недоступен: ${(err as Error).message}`);
    }
    if ((res.status === 401 || res.status === 403) && retry && Date.now() - this.lastRescrape > RESCRAPE_COOLDOWN_MS) {
      await res.body?.cancel().catch(() => {});
      this.lastRescrape = Date.now();
      await this.getClientId(true);
      return this.get<T>(pathOrUrl, false, blocked403);
    }
    if (res.status === 403) throw new ProviderError(this.id, blocked403, 403);
    if (res.status === 404) throw new ProviderError(this.id, 'Не найдено на SoundCloud', 404);
    if (res.status === 429) throw new ProviderError(this.id, 'SoundCloud временно ограничил запросы, попробуйте позже', 429);
    if (!res.ok) throw new ProviderError(this.id, `SoundCloud ответил ошибкой HTTP ${res.status}`, res.status);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ProviderError(this.id, 'SoundCloud вернул некорректный ответ');
    }
  }

  private mapTracks(tracks: ScWebTrack[]): ExternalTrack[] {
    return tracks.filter(isListenable).map((t) => mapScTrack(t, isSnippet(t)));
  }

  async searchArtists(query: string): Promise<ExternalArtist[]> {
    const page = await this.get<ScWebPage<ScUser>>(`/search/users?q=${encodeURIComponent(query)}&limit=20`);
    return page.collection.map(mapScUser);
  }

  async search(query: string): Promise<SearchHits> {
    const [artists, tracks] = await Promise.all([this.searchArtists(query), this.searchTracks(query)]);
    return { artists, tracks };
  }

  async searchTracks(query: string): Promise<ExternalTrack[]> {
    const page = await this.get<ScWebPage<ScWebTrack>>(`/search/tracks?q=${encodeURIComponent(query)}&limit=${SEARCH_TRACK_LIMIT}`);
    return this.mapTracks(page.collection);
  }

  async getArtistTracks(artist: ArtistRef): Promise<ExternalTrack[]> {
    // The newest uploads are enough to find new releases; the site itself asks for 20 at a time. SoundCloud's bot
    // protection answers this list with 403 to non-browser clients, which a new client_id does not change.
    const page = await this.get<ScWebPage<ScWebTrack>>(
      `/users/${scNumericId(artist.externalId)}/tracks?limit=20`,
      false,
      'SoundCloud не отдаёт список треков автора неофициальным клиентам (HTTP 403). Для подписок на авторов SoundCloud нужны официальные ключи',
    );
    return this.mapTracks(page.collection);
  }

  async resolveStream(track: StoredExternalTrack): Promise<StreamSource | null> {
    // Stream links are signed per request with the track's authorization, so read the track fresh every time.
    const t = await this.get<ScWebTrack>(`/tracks/${scNumericId(track.externalId)}`);
    if (t.policy === 'BLOCK' || hasDrm(t.media?.transcodings)) return null;
    // A listed stream can still be missing (404); then the next best one is tried.
    for (const pick of rankTranscodings(t.media?.transcodings).slice(0, 3)) {
      const path = new URL(pick.url);
      if (t.track_authorization) path.searchParams.set('track_authorization', t.track_authorization);
      let url: string | undefined;
      try {
        ({ url } = await this.get<{ url?: string }>(path.toString()));
      } catch (err) {
        if (err instanceof ProviderError && err.code === 404) continue;
        throw err;
      }
      if (url) return { url, kind: pick.format?.protocol === 'hls' ? 'hls' : 'direct' };
    }
    return null;
  }

  canImport(url: URL) {
    return isScPlaylistUrl(url);
  }

  async importPlaylist(url: URL): Promise<ImportedPlaylist> {
    const link = `https://soundcloud.com${url.pathname.replace(/\/$/, '')}`;
    const playlist = await this.get<ScWebPlaylist>(`/resolve?url=${encodeURIComponent(link)}`);
    if (playlist.kind && playlist.kind !== 'playlist' && playlist.kind !== 'system-playlist') {
      throw new ProviderError(this.id, 'Это ссылка не на плейлист SoundCloud');
    }

    // Only the first few tracks come complete; the rest are id stubs to be filled in.
    const listed = (playlist.tracks ?? []).slice(0, MAX_IMPORT);
    const full = new Map<number, ScWebTrack>();
    for (const t of listed) if (t.title) full.set(t.id, t as ScWebTrack);
    const missing = listed.filter((t) => !full.has(t.id)).map((t) => t.id);
    for (let i = 0; i < missing.length; i += HYDRATE_BATCH) {
      const batch = await this.get<ScWebTrack[]>(`/tracks?ids=${missing.slice(i, i + HYDRATE_BATCH).join(',')}`);
      for (const t of batch) full.set(t.id, t);
    }

    const tracks = listed.map((t) => full.get(t.id)).filter((t): t is ScWebTrack => Boolean(t));
    return {
      title: playlist.title,
      description: playlist.description || null,
      url: playlist.permalink_url ?? link,
      tracks: this.mapTracks(tracks),
      total: playlist.track_count ?? (playlist.tracks ?? []).length,
      fetched: listed.length,
    };
  }
}
