// Spotify playlists and albums by link. Spotify plays its music only in its own apps, so soundFy reads just the track
// list — from the public embed page, which needs no keys — and finds each song on the listener's services: a full
// track where there is one, otherwise a 30-second preview. The embed page lists only the first hundred songs of a
// playlist; the rest come from the query Spotify's web player itself uses, with the anonymous token the embed page
// hands out (the way rootscripts/riff reads whole playlists).
import type { ProviderRegistry } from '../providers/index.js';
import type { SyncService } from '../sync/syncService.js';
import { badRequest } from './errors.js';
import { findSong, type WantedSong } from './findSong.js';
import { ProviderError, type FetchLike } from './http.js';

/** Share links that redirect to open.spotify.com (read only for the redirect). */
export const SPOTIFY_SHORT_HOSTS = ['spotify.link', 'spoti.fi'];

/** Songs looked up at once; each one asks a few services in turn. */
const PARALLEL = 3;
/** Most songs taken from one playlist: each is looked up on the services one by one, which takes a while. */
export const MAX_SPOTIFY_TRACKS = 500;

const PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v1/query';
/** The web player's saved «fetchPlaylist» query. Spotify changes it now and then; the embed's list is used then. */
const FETCH_PLAYLIST_HASH = '8964e8eafb21aa992a7d951d256d83285c04be2105d209262901de70cb97584a';
const PAGE = 100;

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
};

export interface SpotifyLink {
  kind: 'playlist' | 'album';
  id: string;
}

/** open.spotify.com/playlist/<id> or /album/<id>, also with a locale prefix (/intl-de/…) or /embed/. */
export function spotifyLink(url: URL): SpotifyLink | null {
  if (!/(^|\.)open\.spotify\.com$/.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]{22})(?:\/|$)/);
  return m ? { kind: m[1] as SpotifyLink['kind'], id: m[2] } : null;
}

interface EmbedTrack {
  title?: string;
  subtitle?: string;
  duration?: number;
}

/**
 * The title and tracks in an embed page's data (__NEXT_DATA__ → props.pageProps.state.data.entity), and the anonymous
 * token the page plays with (…state.settings.session.accessToken).
 */
export function parseEmbed(html: string): { title: string; tracks: WantedSong[]; token: string | null } {
  const json = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  let entity: { name?: string; title?: string; trackList?: EmbedTrack[] } | undefined;
  let token: unknown;
  try {
    const state = json ? JSON.parse(json)?.props?.pageProps?.state : undefined;
    entity = state?.data?.entity;
    token = state?.settings?.session?.accessToken;
  } catch {
    entity = undefined;
  }
  if (!entity || !Array.isArray(entity.trackList)) {
    throw new ProviderError('spotify', 'Spotify не отдал список треков: плейлист закрыт или страница Spotify изменилась');
  }
  const tracks = entity.trackList
    .filter((t) => t.title)
    .map((t) => ({
      title: t.title!.trim(),
      // Several performers come as "A, B" with non-breaking spaces.
      artist: (t.subtitle ?? '').replace(/ /g, ' ').trim(),
      duration: t.duration ? Math.round(t.duration / 1000) : 0,
    }));
  return { title: (entity.name ?? entity.title ?? 'Spotify').trim(), tracks, token: typeof token === 'string' && token ? token : null };
}

interface PathfinderArtists {
  items?: { profile?: { name?: string } }[];
}

interface PathfinderItem {
  itemV2?: {
    data?: {
      __typename?: string;
      name?: string;
      artists?: PathfinderArtists;
      albumOfTrack?: { artists?: PathfinderArtists };
      trackDuration?: { totalMilliseconds?: number };
    };
  };
}

interface PathfinderReply {
  data?: { playlistV2?: { content?: { totalCount?: number; items?: PathfinderItem[] } } };
}

const names = (artists?: PathfinderArtists) => (artists?.items ?? []).map((a) => a.profile?.name?.trim()).filter(Boolean);

/** A song in the web player's answer; nothing for podcast episodes and songs no longer on Spotify. */
export function pathfinderSong(item: PathfinderItem): WantedSong | null {
  const t = item.itemV2?.data;
  if (!t?.name || (t.__typename && t.__typename !== 'Track')) return null;
  const artists = names(t.artists);
  const ms = t.trackDuration?.totalMilliseconds;
  return {
    title: t.name.trim(),
    artist: (artists.length ? artists : names(t.albumOfTrack?.artists)).join(', '),
    duration: typeof ms === 'number' ? Math.round(ms / 1000) : 0,
  };
}

/** The whole playlist, page by page, up to MAX_SPOTIFY_TRACKS songs, and how many songs it has. */
async function wholePlaylist(id: string, token: string, fetchImpl: FetchLike): Promise<{ tracks: WantedSong[]; total: number }> {
  const tracks: WantedSong[] = [];
  let total = Infinity;
  let offset = 0;
  while (offset < total && tracks.length < MAX_SPOTIFY_TRACKS) {
    const res = await fetchImpl(PATHFINDER, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, authorization: `Bearer ${token}`, 'content-type': 'application/json', referer: 'https://open.spotify.com/' },
      body: JSON.stringify({
        operationName: 'fetchPlaylist',
        variables: { uri: `spotify:playlist:${id}`, offset, limit: PAGE, enableWatchFeedEntrypoint: true },
        extensions: { persistedQuery: { version: 1, sha256Hash: FETCH_PLAYLIST_HASH } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ProviderError('spotify', `Spotify ответил ошибкой HTTP ${res.status}`, res.status);
    const content = ((await res.json()) as PathfinderReply).data?.playlistV2?.content;
    const items = content?.items ?? [];
    if (!items.length) {
      if (!offset) throw new ProviderError('spotify', 'Spotify не отдал плейлист');
      break;
    }
    total = content?.totalCount ?? offset + items.length;
    for (const item of items) {
      const song = pathfinderSong(item);
      if (song) tracks.push(song);
    }
    offset += items.length;
  }
  return { tracks: tracks.slice(0, MAX_SPOTIFY_TRACKS), total: Number.isFinite(total) ? total : tracks.length };
}

async function readSpotify(link: SpotifyLink, fetchImpl: FetchLike): Promise<{ title: string; tracks: WantedSong[]; total: number }> {
  let res: Response;
  try {
    res = await fetchImpl(`https://open.spotify.com/embed/${link.kind}/${link.id}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ProviderError('spotify', `Spotify недоступен: ${(err as Error).message}`);
  }
  if (res.status === 404) throw new ProviderError('spotify', 'Spotify: плейлист не найден или закрыт', 404);
  if (!res.ok) throw new ProviderError('spotify', `Spotify ответил ошибкой HTTP ${res.status}`, res.status);
  const embed = parseEmbed(await res.text());
  if (link.kind === 'playlist' && embed.token) {
    try {
      const whole = await wholePlaylist(link.id, embed.token, fetchImpl);
      if (whole.tracks.length >= embed.tracks.length) return { title: embed.title, ...whole };
    } catch {
      // The web player's query changed or was refused: the embed page's first hundred songs will do.
    }
  }
  return { title: embed.title, tracks: embed.tracks, total: embed.tracks.length };
}

/** Runs `work` over `items` a few at a time, keeping the results in order. */
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

/**
 * Imports a Spotify playlist or album into the listener's private playlist. YouTube is not searched: its daily quota
 * would not last through a playlist. Importing the same link again tops the playlist up.
 */
export async function importSpotify(
  ctx: { sync: SyncService; providers: ProviderRegistry; fetchImpl: FetchLike },
  userId: number,
  link: SpotifyLink,
) {
  const list = await readSpotify(link, ctx.fetchImpl);
  if (!list.tracks.length) throw badRequest(`В «${list.title}» нет треков`);
  const services = ctx.providers.list().filter((p) => p.id !== 'youtube');
  const tokens = new Map<string, Promise<string | null>>();
  const token = (provider: string) => {
    if (!tokens.has(provider)) tokens.set(provider, ctx.sync.userToken(provider, userId));
    return tokens.get(provider)!;
  };
  const found = await inOrder(list.tracks, (song) => findSong(song, services, token, { previews: true }));

  const ids: number[] = [];
  let newTracks = 0;
  let previews = 0;
  for (const hit of found) {
    if (!hit) continue;
    const stored = ctx.sync.storeTracks([hit.track], hit.provider, null);
    ids.push(...stored.ids);
    newTracks += stored.newIds.length;
    if (hit.track.isPreview) previews++;
  }
  if (!ids.length) {
    throw badRequest(`Ни одной песни из «${list.title}» не нашлось в подключённых сервисах. Подключите ВК Музыку или SoundCloud`);
  }

  const url = `https://open.spotify.com/${link.kind}/${link.id}`;
  const source = `Импортировано из Spotify: ${url}`;
  const title = list.title.slice(0, 100) || 'Spotify: плейлист';
  const playlistId = ctx.sync.savePlaylist(userId, title, source, ids, source);
  return {
    playlistId,
    title,
    imported: ids.length,
    fetched: list.tracks.length,
    total: list.total,
    newTracks,
    missing: list.tracks.length - ids.length,
    previews,
  };
}
