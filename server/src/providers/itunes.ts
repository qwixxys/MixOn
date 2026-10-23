import { fetchJson, type FetchLike } from '../lib/http.js';
import {
  SEARCH_TRACK_LIMIT,
  type ArtistRef,
  type ExternalArtist,
  type ExternalTrack,
  type MusicProvider,
  type SearchHits,
  type StoredExternalTrack,
  type StreamSource,
} from './types.js';

const API = 'https://itunes.apple.com';

interface ItunesResponse<T> {
  resultCount: number;
  results: T[];
}
interface ItArtist {
  wrapperType: string;
  artistId: number;
  artistName: string;
  artistLinkUrl?: string;
  primaryGenreName?: string;
}
interface ItSong {
  wrapperType: string;
  kind?: string;
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  trackViewUrl?: string;
  primaryGenreName?: string;
}

export function upscaleArtwork(url: string | undefined): string | null {
  return url ? url.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null;
}

export class ItunesProvider implements MusicProvider {
  readonly id = 'itunes' as const;
  readonly name = 'Apple Music / iTunes';
  readonly description = 'iTunes Search API: свежие песни артистов из каталога Apple, 30-секундные превью.';
  readonly requiresToken = false;
  readonly connectMode = null;
  readonly fullTracks = false;
  readonly proxyStreams = false;

  constructor(
    private country: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  isConfigured() {
    return true;
  }

  async searchArtists(query: string): Promise<ExternalArtist[]> {
    const params = new URLSearchParams({ term: query, entity: 'musicArtist', limit: '20', country: this.country });
    const res = await fetchJson<ItunesResponse<ItArtist>>(this.fetchImpl, this.id, `${API}/search?${params}`);
    return res.results
      .filter((a) => a.wrapperType === 'artist')
      .map((a) => ({
        externalId: String(a.artistId),
        name: a.artistName,
        imageUrl: null,
        url: a.artistLinkUrl ?? null,
        subtitle: a.primaryGenreName ?? null,
      }));
  }

  async search(query: string): Promise<SearchHits> {
    const params = new URLSearchParams({ term: query, entity: 'song', limit: String(SEARCH_TRACK_LIMIT), country: this.country });
    const [artists, songs] = await Promise.all([
      this.searchArtists(query),
      fetchJson<ItunesResponse<ItSong>>(this.fetchImpl, this.id, `${API}/search?${params}`),
    ]);
    const tracks = songs.results.filter((s) => s.wrapperType === 'track' && s.previewUrl).map((s) => this.mapSong(s));
    return { artists, tracks };
  }

  private async lookupSongs(params: Record<string, string>): Promise<ItSong[]> {
    const qs = new URLSearchParams({ ...params, country: this.country });
    const res = await fetchJson<ItunesResponse<ItSong>>(this.fetchImpl, this.id, `${API}/lookup?${qs}`);
    return res.results.filter((r) => r.wrapperType === 'track' && (r.kind ?? 'song') === 'song');
  }

  async getArtistTracks(artist: ArtistRef): Promise<ExternalTrack[]> {
    const songs = await this.lookupSongs({ id: artist.externalId, entity: 'song', limit: '50', sort: 'recent' });
    return songs
      .filter((s) => s.previewUrl)
      .map((s) => this.mapSong(s))
      .sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
  }

  private mapSong(s: ItSong): ExternalTrack {
    return {
      externalId: String(s.trackId),
      title: s.trackName,
      artist: s.artistName,
      album: s.collectionName ?? null,
      duration: Math.round((s.trackTimeMillis ?? 30000) / 1000),
      streamUrl: s.previewUrl ?? null,
      coverUrl: upscaleArtwork(s.artworkUrl100),
      externalUrl: s.trackViewUrl ?? null,
      releasedAt: s.releaseDate ? new Date(s.releaseDate).toISOString() : null,
      genre: s.primaryGenreName ?? null,
      isPreview: true,
    };
  }

  async resolveStream(track: StoredExternalTrack): Promise<StreamSource | null> {
    if (track.streamUrl) return { url: track.streamUrl, kind: 'direct' };
    const [song] = await this.lookupSongs({ id: track.externalId });
    return song?.previewUrl ? { url: song.previewUrl, kind: 'direct' } : null;
  }
}
