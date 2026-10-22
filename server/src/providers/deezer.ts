import { fetchJson, ProviderError, type FetchLike } from '../lib/http.js';
import type { ArtistRef, ExternalArtist, ExternalTrack, MusicProvider, StoredExternalTrack, StreamSource } from './types.js';

const API = 'https://api.deezer.com';
/** How many of the newest releases (albums/EPs/singles) to scan per sync. */
const RELEASES_PER_SYNC = 6;

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
}

export function formatFans(n: number | undefined): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M подписчиков`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K подписчиков`;
  return `${n} подписчиков`;
}

export class DeezerProvider implements MusicProvider {
  readonly id = 'deezer' as const;
  readonly name = 'Deezer';
  readonly description = 'Открытый каталог Deezer: новые альбомы и синглы артистов, 30-секундные превью.';
  readonly requiresToken = false;
  readonly connectMode = null;
  readonly fullTracks = false;
  readonly proxyStreams = false;

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
        if (t.readable === false || !t.preview) continue;
        tracks.push({
          externalId: String(t.id),
          title: t.title,
          artist: t.artist?.name ?? '',
          album: album.title,
          duration: t.duration,
          streamUrl: t.preview,
          coverUrl: album.cover_big ?? album.cover_medium ?? null,
          externalUrl: t.link,
          releasedAt: album.release_date ? new Date(`${album.release_date}T00:00:00Z`).toISOString() : null,
          genre: null,
          isPreview: true,
        });
      }
    }
    return tracks;
  }

  async resolveStream(track: StoredExternalTrack): Promise<StreamSource | null> {
    // Preview URLs are signed and expire, so always ask for a fresh one.
    const t = await this.get<DzTrack>(`/track/${encodeURIComponent(track.externalId)}`);
    return t.preview ? { url: t.preview, kind: 'direct' } : null;
  }
}
