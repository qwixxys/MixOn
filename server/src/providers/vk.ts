import { fetchJson, ProviderError, RateLimiter, type FetchLike } from '../lib/http.js';
import {
  streamKind,
  type ArtistRef,
  type ExternalArtist,
  type ExternalTrack,
  type MusicProvider,
  type ProviderContext,
  type StoredExternalTrack,
  type StreamSource,
} from './types.js';

const API = 'https://api.vk.com/method';
/** Artist ids that are not real VK artist ids but a name to search by. */
const NAME_PREFIX = 'name:';
/** VK returns this placeholder instead of a real URL when the token has no audio access. */
const UNAVAILABLE_MARKER = 'audio_api_unavailable';

const AUTH_ERRORS = new Set([5]);

const GENRES: Record<number, string> = {
  1: 'Rock',
  2: 'Pop',
  3: 'Rap & Hip-Hop',
  4: 'Easy Listening',
  5: 'Dance & House',
  6: 'Instrumental',
  7: 'Metal',
  8: 'Dubstep',
  10: 'Drum & Bass',
  11: 'Trance',
  12: 'Chanson',
  13: 'Ethnic',
  14: 'Acoustic & Vocal',
  15: 'Reggae',
  16: 'Classical',
  17: 'Indie Pop',
  19: 'Speech',
  21: 'Alternative',
  22: 'Electropop & Disco',
  1001: 'Jazz & Blues',
};

export interface VkAudio {
  id: number;
  owner_id: number;
  artist: string;
  title: string;
  subtitle?: string;
  duration: number;
  url?: string;
  date?: number;
  access_key?: string;
  genre_id?: number;
  content_restricted?: number;
  album?: { title?: string; thumb?: { photo_300?: string; photo_600?: string; photo_270?: string } };
  main_artists?: { id?: string; name: string }[];
}
interface VkArtist {
  id: string;
  name: string;
  domain?: string;
  photo?: { url: string; width: number; height: number }[];
}
interface VkList<T> {
  count: number;
  items: T[];
}
interface VkEnvelope<T> {
  response?: T;
  error?: { error_code: number; error_msg: string };
}

export interface VkOptions {
  apiVersion: string;
  userAgent: string;
  /** Server-wide token used when the caller has none. */
  fallbackToken?: string | null;
}

function describeError(code: number, msg: string): string {
  switch (code) {
    case 5:
      return 'ВКонтакте: токен недействителен или истёк — подключите аккаунт заново';
    case 6:
      return 'ВКонтакте: слишком много запросов, попробуйте через минуту';
    case 14:
      return 'ВКонтакте требует ввести капчу — попробуйте позже';
    case 15:
    case 201:
    case 203:
      return 'ВКонтакте: нет доступа к аудиозаписям';
    case 3:
      return 'ВКонтакте: метод аудио недоступен для этого токена';
    default:
      return `ВКонтакте: ${msg}`;
  }
}

function pickPhoto(photos: VkArtist['photo']): string | null {
  if (!photos?.length) return null;
  const sorted = [...photos].sort((a, b) => a.width - b.width);
  return (sorted.find((p) => p.width >= 300) ?? sorted[sorted.length - 1]).url;
}

export class VkProvider implements MusicProvider {
  readonly id = 'vk' as const;
  readonly name = 'VK Музыка';
  readonly description =
    'Новые треки артистов из ВКонтакте и импорт ваших аудиозаписей. Полные треки, нужен токен с доступом к аудио.';
  readonly requiresToken = true;
  readonly fullTracks = true;
  // VK links are bound to the client that requested them, so the server relays the audio.
  readonly proxyStreams = true;

  // VK allows ~3 requests per second per token.
  private limiter = new RateLimiter(350);

  constructor(
    private options: VkOptions,
    private fetchImpl: FetchLike = fetch,
  ) {}

  get streamHeaders() {
    return { 'user-agent': this.options.userAgent };
  }

  isConfigured() {
    return true;
  }

  private async call<T>(method: string, params: Record<string, string | number>, token?: string | null): Promise<T> {
    const accessToken = token || this.options.fallbackToken;
    if (!accessToken) {
      throw new ProviderError(this.id, 'Подключите аккаунт ВКонтакте на странице «Сервисы»', 'no_token');
    }
    await this.limiter.wait();
    const body = new URLSearchParams({ access_token: accessToken, v: this.options.apiVersion });
    for (const [k, v] of Object.entries(params)) body.set(k, String(v));
    const res = await fetchJson<VkEnvelope<T>>(this.fetchImpl, this.id, `${API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': this.options.userAgent },
      body: body.toString(),
    });
    if (res.error) {
      throw new ProviderError(this.id, describeError(res.error.error_code, res.error.error_msg), res.error.error_code);
    }
    if (res.response === undefined) throw new ProviderError(this.id, 'ВКонтакте вернул пустой ответ');
    return res.response;
  }

  private mapAudio(a: VkAudio): ExternalTrack {
    const url = a.url && !a.url.includes(UNAVAILABLE_MARKER) ? a.url : null;
    const thumb = a.album?.thumb;
    return {
      externalId: `${a.owner_id}_${a.id}`,
      title: a.subtitle ? `${a.title} (${a.subtitle})` : a.title,
      artist: a.artist,
      album: a.album?.title ?? null,
      duration: a.duration,
      streamUrl: url,
      coverUrl: thumb?.photo_600 ?? thumb?.photo_300 ?? thumb?.photo_270 ?? null,
      externalUrl: `https://vk.com/audio${a.owner_id}_${a.id}`,
      releasedAt: a.date ? new Date(a.date * 1000).toISOString() : null,
      genre: a.genre_id ? (GENRES[a.genre_id] ?? null) : null,
      isPreview: false,
      extra: { accessKey: a.access_key ?? null },
    };
  }

  private mapAudios(items: VkAudio[]): ExternalTrack[] {
    return items.filter((a) => !a.content_restricted).map((a) => this.mapAudio(a));
  }

  async searchArtists(query: string, ctx: ProviderContext): Promise<ExternalArtist[]> {
    try {
      const res = await this.call<VkList<VkArtist>>('audio.searchArtists', { q: query, count: 20 }, ctx.token);
      return res.items.map((a) => ({
        externalId: a.id,
        name: a.name,
        imageUrl: pickPhoto(a.photo),
        url: a.domain ? `https://vk.com/artist/${a.domain}` : null,
        subtitle: null,
      }));
    } catch (err) {
      if (err instanceof ProviderError && (AUTH_ERRORS.has(Number(err.code)) || err.code === 'no_token')) throw err;
      // Not every token can use audio.searchArtists — derive artists from a plain track search instead.
      return this.searchArtistsByTracks(query, ctx);
    }
  }

  private async searchArtistsByTracks(query: string, ctx: ProviderContext): Promise<ExternalArtist[]> {
    const res = await this.call<VkList<VkAudio>>(
      'audio.search',
      { q: query, count: 100, performer_only: 1, auto_complete: 1 },
      ctx.token,
    );
    const found = new Map<string, ExternalArtist>();
    for (const a of res.items) {
      const artists = a.main_artists?.length ? a.main_artists : [{ name: a.artist }];
      for (const artist of artists) {
        const externalId = artist.id ?? `${NAME_PREFIX}${artist.name}`;
        if (!artist.name || found.has(externalId)) continue;
        found.set(externalId, { externalId, name: artist.name, imageUrl: null, url: null, subtitle: null });
      }
    }
    return [...found.values()].slice(0, 20);
  }

  async getArtistTracks(artist: ArtistRef, ctx: ProviderContext): Promise<ExternalTrack[]> {
    let items: VkAudio[];
    if (artist.externalId.startsWith(NAME_PREFIX)) {
      items = await this.searchByName(artist.externalId.slice(NAME_PREFIX.length), ctx);
    } else {
      try {
        const res = await this.call<VkList<VkAudio>>(
          'audio.getAudiosByArtist',
          { artist_id: artist.externalId, count: 100 },
          ctx.token,
        );
        items = res.items;
      } catch (err) {
        if (err instanceof ProviderError && (AUTH_ERRORS.has(Number(err.code)) || err.code === 'no_token')) throw err;
        items = await this.searchByName(artist.name, ctx);
      }
    }
    return this.mapAudios(items).sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
  }

  private async searchByName(name: string, ctx: ProviderContext): Promise<VkAudio[]> {
    // sort=0 orders by upload date, which is what we want for "new releases".
    const res = await this.call<VkList<VkAudio>>(
      'audio.search',
      { q: name, count: 100, performer_only: 1, sort: 0 },
      ctx.token,
    );
    const needle = name.toLowerCase();
    return res.items.filter(
      (a) =>
        a.artist.toLowerCase().includes(needle) || a.main_artists?.some((m) => m.name.toLowerCase() === needle),
    );
  }

  async resolveStream(track: StoredExternalTrack, ctx: ProviderContext): Promise<StreamSource | null> {
    const accessKey = typeof track.extra?.accessKey === 'string' ? track.extra.accessKey : null;
    const id = accessKey ? `${track.externalId}_${accessKey}` : track.externalId;
    const [audio] = await this.call<VkAudio[]>('audio.getById', { audios: id }, ctx.token);
    if (!audio?.url) return null;
    if (audio.url.includes(UNAVAILABLE_MARKER)) {
      throw new ProviderError(this.id, 'ВКонтакте не отдаёт аудио для этого токена — нужен токен с доступом к аудио');
    }
    return { url: audio.url, kind: streamKind(audio.url) };
  }

  async verifyToken(token: string): Promise<{ externalUserId: string; displayName: string }> {
    const [user] = await this.call<{ id: number; first_name: string; last_name: string }[]>('users.get', {}, token);
    if (!user) throw new ProviderError(this.id, 'ВКонтакте: не удалось определить пользователя');
    const probe = await this.call<VkList<VkAudio>>('audio.get', { count: 1 }, token);
    if (probe.items[0]?.url?.includes(UNAVAILABLE_MARKER)) {
      throw new ProviderError(this.id, 'Токен действителен, но не даёт доступа к аудиозаписям');
    }
    return { externalUserId: String(user.id), displayName: `${user.first_name} ${user.last_name}`.trim() };
  }

  async getUserLibrary(ctx: ProviderContext): Promise<ExternalTrack[]> {
    const res = await this.call<VkList<VkAudio>>('audio.get', { count: 500 }, ctx.token);
    return this.mapAudios(res.items);
  }
}
