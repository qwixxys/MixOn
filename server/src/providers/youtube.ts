import { ProviderError, type FetchLike } from '../lib/http.js';
import {
  SEARCH_TRACK_LIMIT,
  type ArtistRef,
  type ExternalArtist,
  type ExternalTrack,
  type ImportedPlaylist,
  type MusicProvider,
  type ProviderContext,
  type SearchHits,
  type StoredExternalTrack,
  type StreamSource,
} from './types.js';
import { VIDEO_NOISE, YouTubeMusicWeb } from './youtubeMusic.js';

const API = 'https://www.googleapis.com/youtube/v3';
/** YouTube's "Music" video category. */
const MUSIC_CATEGORY = '10';
/** Shorter videos are Shorts or teasers, longer ones mixes, concerts and streams. */
const MIN_SECONDS = 60;
const MAX_SECONDS = 20 * 60;
/** Most tracks a single import reads from a playlist (each page of 50 costs a unit of the key's daily quota). */
const MAX_IMPORT = 500;
const PAGE = 50;

interface YtThumbnails {
  default?: { url: string };
  medium?: { url: string };
  high?: { url: string };
  standard?: { url: string };
  maxres?: { url: string };
}
interface YtList<T> {
  items?: T[];
  nextPageToken?: string;
}
interface YtError {
  error?: { code: number; message: string; errors?: { reason?: string }[] };
}
interface YtSearchItem {
  id: { kind?: string; channelId?: string; videoId?: string };
  snippet: { title: string; thumbnails?: YtThumbnails };
}
interface YtChannel {
  id: string;
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}
interface YtPlaylistItem {
  snippet?: { title?: string; videoOwnerChannelTitle?: string };
  contentDetails?: { videoId?: string };
}
interface YtPlaylist {
  snippet?: { title: string; description?: string };
  contentDetails?: { itemCount?: number };
}
export interface YtVideo {
  id: string;
  snippet: {
    title: string;
    description?: string;
    channelTitle: string;
    publishedAt?: string;
    categoryId?: string;
    liveBroadcastContent?: string;
    thumbnails?: YtThumbnails;
  };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean };
}

/** "PT3M21S" → 201 seconds. */
export function parseDuration(value: string | undefined): number {
  const m = value?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, d = '0', h = '0', min = '0', s = '0'] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(s);
}

function bestThumbnail(t: YtThumbnails | undefined): string | null {
  return t?.maxres?.url ?? t?.standard?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? null;
}

/** Auto-generated "Artist - Topic" channels hold the official audio of an artist's releases. */
const channelArtist = (title: string) => title.replace(/\s+-\s+Topic$/i, '').replace(/VEVO$/, '').trim();


/**
 * Release tracks on Topic channels carry their real metadata in the description:
 * "Provided to YouTube by Label\n\nSong · Artist · Artist 2\n\nAlbum\n\n℗ 2024 Label\n\nReleased on: 2024-05-17".
 */
export function parseArtTrack(description: string | undefined) {
  if (!description?.startsWith('Provided to YouTube by')) return null;
  const blocks = description.split(/\n\s*\n/).map((b) => b.trim());
  const [title, ...artists] = (blocks[1] ?? '').split(' · ').map((s) => s.trim());
  if (!title || !artists.length) return null;
  const released = description.match(/Released on:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  return {
    title,
    artist: artists.join(', '),
    album: blocks[2] && !/^[℗©]/.test(blocks[2]) ? blocks[2] : null,
    releasedAt: released ? new Date(`${released}T00:00:00Z`).toISOString() : null,
  };
}

/** A video as a track: release metadata when YouTube provides it, otherwise "Artist - Song" from the title. */
export function videoToTrack(video: YtVideo): ExternalTrack {
  const { snippet } = video;
  const art = parseArtTrack(snippet.description);
  let title = art?.title ?? snippet.title.replace(VIDEO_NOISE, '').trim();
  let artist = art?.artist ?? channelArtist(snippet.channelTitle);
  const dash = art ? null : title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) [, artist, title] = dash;
  return {
    externalId: video.id,
    title: title || snippet.title,
    artist,
    album: art?.album ?? null,
    duration: parseDuration(video.contentDetails?.duration),
    streamUrl: null,
    coverUrl: bestThumbnail(snippet.thumbnails),
    externalUrl: `https://music.youtube.com/watch?v=${video.id}`,
    releasedAt: art?.releasedAt ?? snippet.publishedAt ?? null,
    genre: null,
    isPreview: false,
  };
}

/** A song rather than a teaser or an hours-long mix; songs listed without a length are kept. */
const songLength = (t: ExternalTrack) => !t.duration || (t.duration >= MIN_SECONDS && t.duration <= MAX_SECONDS);

/** Videos the official player can show here: embeddable and not a live stream. */
const playable = (v: YtVideo) => v.status?.embeddable !== false && (v.snippet.liveBroadcastContent ?? 'none') === 'none';

function formatSubscribers(channel: YtChannel | undefined): string | null {
  if (channel?.statistics?.hiddenSubscriberCount) return null;
  return subscribersLabel(Number(channel?.statistics?.subscriberCount));
}

function subscribersLabel(n: number): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M подписчиков`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K подписчиков`;
  return `${n} подписчиков`;
}

/**
 * YouTube and YouTube Music: through the official YouTube Data API v3 when the owner gave an API key, otherwise through
 * YouTube Music's web player API without one (youtubeMusic.ts). Songs looked up to stand in for others always go the
 * keyless way, which costs no quota. YouTube allows playing its videos only in its own embedded player, so tracks
 * resolve to a video id that the app plays in that player (client/src/store/youtube.ts); nothing is downloaded or
 * relayed.
 */
export class YouTubeProvider implements MusicProvider {
  readonly id = 'youtube' as const;
  readonly name = 'YouTube Music';
  readonly description =
    'Релизы и клипы артистов с YouTube и YouTube Music, импорт плейлистов по ссылке. Играют во встроенном плеере YouTube.';
  readonly requiresToken = false;
  readonly connectMode = null;
  readonly fullTracks = true;
  readonly proxyStreams = false;
  readonly shortLinkHosts = ['youtu.be'];

  private web: YouTubeMusicWeb;

  constructor(
    private apiKey: string | null,
    private fetchImpl: FetchLike = fetch,
  ) {
    this.web = new YouTubeMusicWeb(fetchImpl);
  }

  isConfigured() {
    return true;
  }

  /** Without a key it goes through the web player's API, which YouTube does not allow. */
  get unofficial() {
    return !this.apiKey;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.apiKey) throw new ProviderError(this.id, 'YouTube не настроен: укажите ключ YouTube Data API в карточке YouTube Music на странице «Сервисы»');
    const url = `${API}${path}?${new URLSearchParams({ ...params, key: this.apiKey })}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new ProviderError(this.id, `Сервис недоступен: ${(err as Error).message}`);
    }
    let body: T & YtError;
    try {
      body = (await res.json()) as T & YtError;
    } catch {
      throw new ProviderError(this.id, `YouTube ответил ошибкой HTTP ${res.status}`, res.status);
    }
    if (!res.ok || body.error) throw new ProviderError(this.id, describeError(body.error, res.status), body.error?.code ?? res.status);
    return body;
  }

  /** Full details of up to 50 videos per request, in the order asked. */
  private async videos(ids: string[]): Promise<YtVideo[]> {
    const found = new Map<string, YtVideo>();
    for (let i = 0; i < ids.length; i += PAGE) {
      const page = await this.get<YtList<YtVideo>>('/videos', { part: 'snippet,contentDetails,status', id: ids.slice(i, i + PAGE).join(','), maxResults: String(PAGE) });
      for (const v of page.items ?? []) found.set(v.id, v);
    }
    return ids.map((id) => found.get(id)).filter((v): v is YtVideo => v !== undefined);
  }

  async searchArtists(query: string): Promise<ExternalArtist[]> {
    if (!this.apiKey) return this.web.artists(query, subscribersLabel);
    const res = await this.get<YtList<YtSearchItem>>('/search', { part: 'snippet', type: 'channel', q: query, maxResults: '20' });
    return this.toArtists(res.items ?? []);
  }

  /** Channels and music videos from a single search request, which costs 100 units of the key's daily quota. */
  async search(query: string): Promise<SearchHits> {
    if (!this.apiKey) {
      const [tracks, artists] = await Promise.all([this.web.songs(query), this.web.artists(query, subscribersLabel)]);
      return { artists, tracks: tracks.filter(songLength).slice(0, SEARCH_TRACK_LIMIT) };
    }
    const res = await this.get<YtList<YtSearchItem>>('/search', { part: 'snippet', type: 'video,channel', q: query, maxResults: '25' });
    const items = res.items ?? [];
    const videoIds = items.map((i) => i.id.videoId).filter((id): id is string => Boolean(id));
    const [artists, videos] = await Promise.all([
      this.toArtists(items.filter((i) => !i.id.videoId)),
      videoIds.length ? this.videos(videoIds) : Promise.resolve([]),
    ]);
    const tracks = videos
      .filter((v) => playable(v) && (v.snippet.categoryId ?? MUSIC_CATEGORY) === MUSIC_CATEGORY)
      .map(videoToTrack)
      .filter((t) => t.duration >= MIN_SECONDS && t.duration <= MAX_SECONDS)
      .slice(0, SEARCH_TRACK_LIMIT);
    return { artists, tracks };
  }

  /** The same song found to stand in for one from elsewhere («Слушать через», carrying on without the video window). */
  async searchTracks(query: string, ctx: ProviderContext): Promise<ExternalTrack[]> {
    return (await this.web.songs(query, ctx.background ? 'background' : 'normal')).filter(songLength);
  }

  private async toArtists(items: YtSearchItem[]): Promise<ExternalArtist[]> {
    const found = items.filter((c) => c.id.channelId);
    if (!found.length) return [];
    const stats = await this.get<YtList<YtChannel>>('/channels', { part: 'statistics', id: found.map((c) => c.id.channelId).join(',') });
    const byId = new Map((stats.items ?? []).map((c) => [c.id, c]));
    return found.map((c) => {
      const id = c.id.channelId!;
      const topic = /\s-\sTopic$/i.test(c.snippet.title);
      const subscribers = formatSubscribers(byId.get(id));
      return {
        externalId: id,
        name: channelArtist(c.snippet.title),
        imageUrl: bestThumbnail(c.snippet.thumbnails),
        url: `https://music.youtube.com/channel/${id}`,
        subtitle: [topic ? 'Релизы (YouTube Music)' : null, subscribers].filter(Boolean).join(' · ') || null,
      };
    });
  }

  async getArtistTracks(artist: ArtistRef): Promise<ExternalTrack[]> {
    // Without a key: the songs on the artist's page, its most played rather than its newest.
    if (!this.apiKey) return (await this.web.artistSongs(artist.externalId)).filter(songLength);
    const [channel] = (await this.get<YtList<YtChannel>>('/channels', { part: 'contentDetails', id: artist.externalId })).items ?? [];
    const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new ProviderError(this.id, 'YouTube: канал не найден', 404);
    const items = await this.get<YtList<YtPlaylistItem>>('/playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: String(PAGE) });
    const ids = (items.items ?? []).map((i) => i.contentDetails?.videoId).filter((id): id is string => Boolean(id));
    return (await this.videos(ids))
      .filter((v) => playable(v) && (v.snippet.categoryId ?? MUSIC_CATEGORY) === MUSIC_CATEGORY)
      .map(videoToTrack)
      .filter((t) => t.duration >= MIN_SECONDS && t.duration <= MAX_SECONDS)
      .sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
  }

  async resolveStream(track: StoredExternalTrack): Promise<StreamSource | null> {
    return { url: `https://www.youtube.com/watch?v=${encodeURIComponent(track.externalId)}`, kind: 'youtube' };
  }

  canImport(url: URL): boolean {
    return /(^|\.)youtube\.com$/.test(url.hostname) && Boolean(playlistId(url));
  }

  async importPlaylist(url: URL): Promise<ImportedPlaylist> {
    const id = playlistId(url)!;
    if (!this.apiKey) {
      const list = await this.web.playlist(id, MAX_IMPORT);
      return { ...list, description: null, url: `https://music.youtube.com/playlist?list=${id}` };
    }
    const [playlist] = (await this.get<YtList<YtPlaylist>>('/playlists', { part: 'snippet,contentDetails', id })).items ?? [];
    if (!playlist?.snippet) throw new ProviderError(this.id, 'YouTube: плейлист не найден или скрыт', 404);
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.get<YtList<YtPlaylistItem>>('/playlistItems', {
        part: 'contentDetails',
        playlistId: id,
        maxResults: String(PAGE),
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of page.items ?? []) if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < MAX_IMPORT);
    const read = ids.slice(0, MAX_IMPORT);
    // Deleted and private videos are missing from the details; the rest must be playable in the embedded player.
    const tracks = (await this.videos(read)).filter(playable).map(videoToTrack);
    return {
      title: playlist.snippet.title,
      description: playlist.snippet.description || null,
      url: `https://music.youtube.com/playlist?list=${id}`,
      tracks,
      total: playlist.contentDetails?.itemCount ?? read.length,
      fetched: read.length,
    };
  }
}

/** The playlist in a link: youtube.com/playlist?list=…, music.youtube.com/playlist?list=… or a video opened in one. */
function playlistId(url: URL): string | null {
  const list = url.searchParams.get('list');
  // RD… are mixes YouTube makes for each viewer; the API cannot read them.
  if (!list || !/^[\w-]{10,}$/.test(list) || list.startsWith('RD')) return null;
  return /^\/(playlist|watch)\/?$/.test(url.pathname) ? list : null;
}

function describeError(error: YtError['error'], status: number): string {
  const reason = error?.errors?.[0]?.reason ?? '';
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return 'YouTube: дневная квота ключа API исчерпана, она обновится завтра';
  }
  if (reason === 'keyInvalid' || /API key not valid/i.test(error?.message ?? '')) return 'YouTube: ключ API недействителен';
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(error?.message ?? '')) {
    return 'YouTube: в проекте Google Cloud не включён YouTube Data API v3';
  }
  if (reason === 'playlistNotFound' || reason === 'channelNotFound') return 'YouTube: не найдено или скрыто';
  return `YouTube ответил ошибкой: ${error?.message ?? `HTTP ${status}`}`;
}
