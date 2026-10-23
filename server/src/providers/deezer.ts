import { fetchJson, ProviderError, type FetchLike } from '../lib/http.js';
import { closeness, normalizeText, primaryArtist } from '../lib/matching.js';
import {
  SEARCH_TRACK_LIMIT,
  type ArtistRef,
  type ExternalArtist,
  type ExternalTrack,
  type ImportedPlaylist,
  type MusicProvider,
  type SearchHits,
  type SimilarSeed,
  type StoredExternalTrack,
  type StreamSource,
} from './types.js';

const API = 'https://api.deezer.com';
/** How many of the newest releases (albums/EPs/singles) to scan per sync. */
const RELEASES_PER_SYNC = 6;

/** Deezer genre ids of albums (GET /genre); names are normalised later. */
export const DEEZER_GENRES: Record<number, string> = {
  132: 'Pop',
  116: 'Rap/Hip Hop',
  122: 'Reggaeton',
  152: 'Rock',
  113: 'Dance',
  165: 'R&B',
  85: 'Alternative',
  186: 'Christian',
  106: 'Electro',
  466: 'Folk',
  144: 'Reggae',
  129: 'Jazz',
  84: 'Country',
  98: 'Classical',
  173: 'Films/Games',
  464: 'Metal',
  169: 'Soul & Funk',
  2: 'African Music',
  12: 'Arabic Music',
  16: 'Asian Music',
  153: 'Blues',
  75: 'Brazilian Music',
  71: 'Cumbia',
  81: 'Indian Music',
  95: 'Kids',
  197: 'Latin Music',
};

interface DeezerError {
  error?: { type: string; message: string; code: number };
}
interface DeezerList<T> extends DeezerError {
  data?: T[];
}
interface DzArtist {
  id: number;
  name: string;
  link: string;
  picture_medium?: string;
  picture_big?: string;
  nb_fan?: number;
}
interface DzAlbum {
  id: number;
  title: string;
  cover_medium?: string;
  cover_big?: string;
  release_date?: string;
  record_type?: string;
  genre_id?: number;
}
interface DzTrack extends DeezerError {
  id: number;
  title: string;
  duration: number;
  preview: string;
  link: string;
  artist: { id: number; name: string };
  readable?: boolean;
  /** Present in playlist track lists, absent in album track lists. */
  album?: { id: number; title: string; cover_medium?: string; cover_big?: string };
}
interface DzPlaylist extends DeezerError {
  id: number;
  title: string;
  description?: string;
  nb_tracks?: number;
}
interface DzAlbumDetail extends DzAlbum, DeezerError {
  nb_tracks?: number;
  tracks?: { data: DzTrack[] };
}

/** Most tracks a single import reads from a Deezer playlist. */
const MAX_IMPORT = 1000;
const PAGE = 100;

export function formatFans(n: number | undefined): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M подписчиков`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K подписчиков`;
  return `${n} подписчиков`;
}

/** Deezer dates are "YYYY-MM-DD"; unknown ones come as "0000-00-00". */
export function deezerDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A playable preview track, or null when Deezer cannot play it in this region. */
function mapTrack(t: DzTrack, album: Partial<DzAlbum> | undefined): ExternalTrack | null {
  if (t.readable === false || !t.preview) return null;
  return {
    externalId: String(t.id),
    title: t.title,
    artist: t.artist?.name ?? '',
    album: album?.title ?? null,
    duration: t.duration,
    streamUrl: t.preview,
    coverUrl: album?.cover_big ?? album?.cover_medium ?? null,
    externalUrl: t.link,
    releasedAt: deezerDate(album?.release_date),
    genre: album?.genre_id ? (DEEZER_GENRES[album.genre_id] ?? null) : null,
    isPreview: true,
  };
}

const LINK = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|album)\/(\d+)/i;

export class DeezerProvider implements MusicProvider {
  readonly id = 'deezer' as const;
  readonly name = 'Deezer';
  readonly description = 'Открытый каталог Deezer: новые альбомы и синглы артистов, 30-секундные превью.';
  readonly requiresToken = false;
  readonly connectMode = null;
  readonly fullTracks = false;
  readonly proxyStreams = false;
  readonly shortLinkHosts = ['link.deezer.com', 'deezer.page.link', 'dzr.page.link'];

  /** Deezer artist ids by normalised name, for the artist radio; null when Deezer does not know the artist. */
  private artistIds = new Map<string, string | null>();

  constructor(private fetchImpl: FetchLike = fetch) {}

  isConfigured() {
    return true;
  }

  private async get<T extends DeezerError>(path: string): Promise<T> {
    const body = await fetchJson<T>(this.fetchImpl, this.id, `${API}${path}`);
    if (body.error) throw new ProviderError(this.id, `Deezer: ${body.error.message}`, body.error.code);
    return body;
  }

  async searchArtists(query: string): Promise<ExternalArtist[]> {
    const res = await this.get<DeezerList<DzArtist>>(`/search/artist?q=${encodeURIComponent(query)}&limit=20`);
    return (res.data ?? []).map((a) => ({
      externalId: String(a.id),
      name: a.name,
      imageUrl: a.picture_big ?? a.picture_medium ?? null,
      url: a.link,
      subtitle: formatFans(a.nb_fan),
    }));
  }

  async search(query: string): Promise<SearchHits> {
    const [artists, tracks] = await Promise.all([this.searchArtists(query), this.searchTracks(query)]);
    return { artists, tracks };
  }

  async searchTracks(query: string): Promise<ExternalTrack[]> {
    const found = await this.get<DeezerList<DzTrack>>(`/search/track?q=${encodeURIComponent(query)}&limit=${SEARCH_TRACK_LIMIT}`);
    return (found.data ?? []).map((t) => mapTrack(t, t.album)).filter((t): t is ExternalTrack => t !== null);
  }

  async getArtistTracks(artist: ArtistRef): Promise<ExternalTrack[]> {
    const albums = await this.get<DeezerList<DzAlbum>>(`/artist/${encodeURIComponent(artist.externalId)}/albums?limit=100`);
    const latest = (albums.data ?? [])
      .filter((a) => a.release_date)
      .sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
      .slice(0, RELEASES_PER_SYNC);

    const tracks: ExternalTrack[] = [];
    for (const album of latest) {
      const list = await this.get<DeezerList<DzTrack>>(`/album/${album.id}/tracks?limit=100`);
      for (const t of list.data ?? []) {
        const track = mapTrack(t, album);
        if (track) tracks.push(track);
      }
    }
    return tracks;
  }

  canImport(url: URL): boolean {
    return /(^|\.)deezer\.com$/.test(url.hostname) && LINK.test(url.pathname);
  }

  /** Public playlists and albums; the public API needs no key and no login. */
  async importPlaylist(url: URL): Promise<ImportedPlaylist> {
    const [, kind, id] = url.pathname.match(LINK)!;
    if (kind.toLowerCase() === 'album') {
      const album = await this.get<DzAlbumDetail>(`/album/${id}`);
      let list = album.tracks?.data ?? [];
      // The embedded list can come back shorter than the album; the paged endpoint has all of it.
      if (album.nb_tracks && list.length < album.nb_tracks) list = await this.pages(`/album/${id}/tracks`);
      const tracks = list.map((t) => mapTrack(t, album)).filter((t): t is ExternalTrack => t !== null);
      return { title: album.title, description: null, url: `https://www.deezer.com/album/${id}`, tracks, total: album.nb_tracks ?? list.length, fetched: list.length };
    }
    const playlist = await this.get<DzPlaylist>(`/playlist/${id}`);
    const raw = await this.pages(`/playlist/${id}/tracks`);
    const tracks = raw.map((t) => mapTrack(t, t.album)).filter((t): t is ExternalTrack => t !== null);
    return {
      title: playlist.title,
      description: playlist.description || null,
      url: `https://www.deezer.com/playlist/${id}`,
      tracks,
      total: playlist.nb_tracks ?? raw.length,
      fetched: raw.length,
    };
  }

  /** Reads a paged track list up to the import limit. */
  private async pages(path: string): Promise<DzTrack[]> {
    const items: DzTrack[] = [];
    while (items.length < MAX_IMPORT) {
      const page = await this.get<DeezerList<DzTrack>>(`${path}?index=${items.length}&limit=${PAGE}`);
      items.push(...(page.data ?? []));
      if (!page.data?.length || page.data.length < PAGE) break;
    }
    return items.slice(0, MAX_IMPORT);
  }

  /** The performer's Deezer radio: their songs mixed with those of similar artists. */
  async similarTracks(seed: SimilarSeed): Promise<ExternalTrack[]> {
    const id = seed.externalId ? await this.artistOfTrack(seed.externalId) : await this.artistId(seed.artist);
    if (!id) return [];
    const radio = await this.get<DeezerList<DzTrack>>(`/artist/${encodeURIComponent(id)}/radio?limit=40`);
    return (radio.data ?? []).map((t) => mapTrack(t, t.album)).filter((t): t is ExternalTrack => t !== null);
  }

  async popularTracks(): Promise<ExternalTrack[]> {
    const chart = await this.get<DeezerList<DzTrack>>('/chart/0/tracks?limit=50');
    return (chart.data ?? []).map((t) => mapTrack(t, t.album)).filter((t): t is ExternalTrack => t !== null);
  }

  private async artistOfTrack(trackId: string): Promise<string | null> {
    const t = await this.get<DzTrack>(`/track/${encodeURIComponent(trackId)}`);
    return t.artist?.id ? String(t.artist.id) : null;
  }

  /** The Deezer artist named so, if the best search hit has that name. */
  private async artistId(name: string): Promise<string | null> {
    const key = normalizeText(primaryArtist(name));
    if (!key) return null;
    if (this.artistIds.has(key)) return this.artistIds.get(key)!;
    const found = await this.get<DeezerList<DzArtist>>(`/search/artist?q=${encodeURIComponent(primaryArtist(name))}&limit=5`);
    const match = (found.data ?? []).find((a) => closeness(normalizeText(a.name), key) === 2) ?? null;
    const id = match ? String(match.id) : null;
    if (this.artistIds.size > 500) this.artistIds.clear();
    this.artistIds.set(key, id);
    return id;
  }

  async resolveStream(track: StoredExternalTrack): Promise<StreamSource | null> {
    // Preview URLs are signed and expire, so always ask for a fresh one.
    const t = await this.get<DzTrack>(`/track/${encodeURIComponent(track.externalId)}`);
    return t.preview ? { url: t.preview, kind: 'direct' } : null;
  }
}
