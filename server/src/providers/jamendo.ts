import { fetchJson, ProviderError, type FetchLike } from '../lib/http.js';
import type { ArtistRef, ExternalArtist, ExternalTrack, MusicProvider, StoredExternalTrack, StreamSource } from './types.js';

const API = 'https://api.jamendo.com/v3.0';

interface JamendoResponse<T> {
  headers: { status: string; code: number; error_message?: string };
  results: T[];
}
interface JmArtist {
  id: string;
  name: string;
  image?: string;
  shareurl?: string;
  website?: string;
}
interface JmTrack {
  id: string;
  name: string;
  duration: number;
  artist_name: string;
  album_name?: string;
  album_image?: string;
  image?: string;
  audio?: string;
  shareurl?: string;
  releasedate?: string;
  audiodownload_allowed?: boolean;
  musicinfo?: { tags?: { genres?: string[] } };
}

export class JamendoProvider implements MusicProvider {
  readonly id = 'jamendo' as const;
  readonly name = 'Jamendo';
  readonly description = 'Независимые артисты с музыкой под Creative Commons — полные треки.';
  readonly requiresToken = false;
  readonly connectMode = null;
  readonly fullTracks = true;
  readonly proxyStreams = false;

  constructor(
    private clientId: string | null,
    private fetchImpl: FetchLike = fetch,
  ) {}

  isConfigured() {
    return Boolean(this.clientId);
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T[]> {
    if (!this.clientId) throw new ProviderError(this.id, 'Jamendo не настроен: задайте JAMENDO_CLIENT_ID');
    const qs = new URLSearchParams({ client_id: this.clientId, format: 'json', ...params });
    const res = await fetchJson<JamendoResponse<T>>(this.fetchImpl, this.id, `${API}${path}?${qs}`);
    if (res.headers?.status !== 'success') {
      throw new ProviderError(this.id, `Jamendo: ${res.headers?.error_message || 'ошибка запроса'}`, res.headers?.code);
    }
    return res.results;
  }

  async searchArtists(query: string): Promise<ExternalArtist[]> {
    const artists = await this.get<JmArtist>('/artists/', { namesearch: query, limit: '20' });
    return artists.map((a) => ({
      externalId: a.id,
      name: a.name,
      imageUrl: a.image || null,
      url: a.shareurl ?? a.website ?? null,
      subtitle: null,
    }));
  }

  async getArtistTracks(artist: ArtistRef): Promise<ExternalTrack[]> {
    const tracks = await this.get<JmTrack>('/tracks/', {
      artist_id: artist.externalId,
      order: 'releasedate_desc',
      limit: '50',
      audioformat: 'mp32',
      imagesize: '300',
      include: 'musicinfo',
    });
    return tracks
      .filter((t) => t.audio)
      .map((t) => ({
        externalId: t.id,
        title: t.name,
        artist: t.artist_name,
        album: t.album_name || null,
        duration: t.duration,
        streamUrl: t.audio ?? null,
        coverUrl: t.album_image || t.image || null,
        externalUrl: t.shareurl ?? null,
        releasedAt: t.releasedate ? new Date(`${t.releasedate}T00:00:00Z`).toISOString() : null,
        genre: t.musicinfo?.tags?.genres?.[0] ?? null,
        isPreview: false,
      }));
  }

  async resolveStream(track: StoredExternalTrack): Promise<StreamSource | null> {
    if (track.streamUrl) return { url: track.streamUrl, kind: 'direct' };
    const [t] = await this.get<JmTrack>('/tracks/', { id: track.externalId, audioformat: 'mp32' });
    return t?.audio ? { url: t.audio, kind: 'direct' } : null;
  }
}
