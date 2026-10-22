import { fetchJson, ProviderError, type FetchLike } from '../lib/http.js';

const API = 'https://api.genius.com';

export interface GeniusArtistRaw {
  id: number;
  name: string;
  url?: string;
  image_url?: string;
}

export interface GeniusHitRaw {
  id: number;
  title: string;
  full_title?: string;
  url: string;
  primary_artist: GeniusArtistRaw;
  song_art_image_thumbnail_url?: string;
  release_date_for_display?: string | null;
}

export interface GeniusSongRaw extends GeniusHitRaw {
  release_date?: string | null;
  album?: { id: number; name: string; url?: string; cover_art_url?: string } | null;
  featured_artists?: GeniusArtistRaw[];
  producer_artists?: GeniusArtistRaw[];
  writer_artists?: GeniusArtistRaw[];
  custom_performances?: { label: string; artists: GeniusArtistRaw[] }[];
  song_relationships?: { relationship_type: string; songs: GeniusHitRaw[] }[];
  media?: { provider: string; type?: string; url: string }[];
  description?: { plain?: string };
  embed_content?: string | null;
  recording_location?: string | null;
  stats?: { pageviews?: number };
  header_image_thumbnail_url?: string;
}

interface Envelope<T> {
  meta: { status: number; message?: string };
  response: T;
}

/** Official Genius API (https://docs.genius.com) with a client access token. */
export class GeniusClient {
  constructor(
    private accessToken: string | null,
    private fetchImpl: FetchLike = fetch,
  ) {}

  isConfigured() {
    return Boolean(this.accessToken);
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.accessToken) throw new ProviderError('genius', 'Genius не настроен: задайте GENIUS_ACCESS_TOKEN');
    let body: Envelope<T>;
    try {
      body = await fetchJson<Envelope<T>>(this.fetchImpl, 'genius', `${API}${path}`, {
        headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' },
      });
    } catch (err) {
      if (err instanceof ProviderError && err.code === 401) {
        throw new ProviderError('genius', 'Genius: токен недействителен — проверьте GENIUS_ACCESS_TOKEN', 401);
      }
      if (err instanceof ProviderError && err.code === 404) throw new ProviderError('genius', 'Genius: песня не найдена', 404);
      throw err;
    }
    if (body.meta?.status && body.meta.status !== 200) {
      throw new ProviderError('genius', `Genius: ${body.meta.message ?? `ошибка ${body.meta.status}`}`, body.meta.status);
    }
    return body.response;
  }

  async search(query: string): Promise<GeniusHitRaw[]> {
    const res = await this.get<{ hits: { type: string; result: GeniusHitRaw }[] }>(`/search?q=${encodeURIComponent(query)}`);
    return res.hits.filter((h) => h.type === 'song').map((h) => h.result);
  }

  async song(id: number): Promise<GeniusSongRaw> {
    const res = await this.get<{ song: GeniusSongRaw }>(`/songs/${id}?text_format=plain`);
    return res.song;
  }
}
