import type { KeyValueStore } from '../db/index.js';
import { fetchJson, ProviderError, type FetchLike } from '../lib/http.js';
import { formatFans } from './deezer.js';
import {
  streamKind,
  type ArtistRef,
  type ExternalArtist,
  type ExternalTrack,
  type MusicProvider,
  type OAuthFlow,
  type OAuthTokens,
  type ProviderContext,
  type StoredExternalTrack,
  type StreamSource,
} from './types.js';

const API = 'https://api.soundcloud.com';
const AUTH = 'https://secure.soundcloud.com';
const APP_TOKEN_KEY = 'soundcloud.app_token';
/** Upper bound for paginated imports (likes, followings). */
const MAX_IMPORT = 1000;

interface ScUser {
  id: number;
  urn?: string;
  username: string;
  full_name?: string;
  avatar_url?: string;
  permalink_url?: string;
  followers_count?: number;
  track_count?: number;
}
export interface ScTrack {
  id: number;
  urn?: string;
  title: string;
  user?: ScUser;
  duration: number;
  artwork_url?: string | null;
  permalink_url?: string;
  created_at?: string;
  genre?: string | null;
  streamable?: boolean;
  access?: 'playable' | 'preview' | 'blocked' | null;
}
interface ScStreams {
  http_mp3_128_url?: string;
  hls_mp3_128_url?: string;
  hls_aac_160_url?: string;
  preview_mp3_128_url?: string;
}
interface ScPage<T> {
  collection: T[];
  next_href?: string | null;
}
interface ScTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface SoundCloudOptions {
  clientId: string | null;
  clientSecret: string | null;
  /** Persists the app token: SoundCloud strictly limits how often new ones may be requested. */
  store?: KeyValueStore;
}

/** SoundCloud v1 dates look like "2024/05/01 12:30:00 +0000". */
export function parseScDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  const date = new Date(m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}${m[5]}:${m[6]}` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Artwork URLs come in "-large" (100px); ask for the 500px version. */
export function scArtwork(url: string | null | undefined): string | null {
  return url ? url.replace(/-large(\.\w+)(\?.*)?$/, '-t500x500$1$2') : null;
}

function tokensFrom(res: ScTokenResponse): OAuthTokens {
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? null,
    expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000).toISOString() : null,
  };
}

export class SoundCloudProvider implements MusicProvider {
  readonly id = 'soundcloud' as const;
  readonly name = 'SoundCloud';
  readonly description = 'Новые треки авторов SoundCloud, импорт ваших лайков и подписок. Полные треки через официальный API.';
  readonly requiresToken = false;
  readonly connectMode = 'oauth' as const;
  readonly libraryLabel = 'лайки';
  readonly fullTracks = true;
  // Resolved stream URLs are signed CDN links that browsers can open directly.
  readonly proxyStreams = false;
  readonly oauth: OAuthFlow;

  private appToken: { token: string; expiresAt: number } | null = null;
  private appTokenRequest: Promise<string> | null = null;

  constructor(
    private options: SoundCloudOptions,
    private fetchImpl: FetchLike = fetch,
  ) {
    const client = () => ({ client_id: options.clientId ?? '', client_secret: options.clientSecret ?? '' });
    this.oauth = {
      authorizeUrl: ({ state, codeChallenge, redirectUri }) =>
        `${AUTH}/authorize?${new URLSearchParams({
          client_id: options.clientId ?? '',
          redirect_uri: redirectUri,
          response_type: 'code',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
        })}`,
      exchangeCode: ({ code, codeVerifier, redirectUri }) =>
        this.tokenRequest({
          grant_type: 'authorization_code',
          ...client(),
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          code,
        }),
      refresh: (refreshToken) => this.tokenRequest({ grant_type: 'refresh_token', ...client(), refresh_token: refreshToken }),
    };
  }

  /** Code and refresh grants carry the client credentials in the body; the client-credentials grant uses Basic auth. */
  private async tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json; charset=utf-8',
    };
    if (params.grant_type === 'client_credentials') {
      headers.authorization = `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64')}`;
    }
    const res = await fetchJson<ScTokenResponse>(this.fetchImpl, this.id, `${AUTH}/oauth/token`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(params).toString(),
    });
    return tokensFrom(res);
  }

  private async requestAppToken(): Promise<string> {
    const tokens = await this.tokenRequest({ grant_type: 'client_credentials' });
    this.appToken = {
      token: tokens.accessToken,
      expiresAt: tokens.expiresAt ? Date.parse(tokens.expiresAt) : Date.now() + 3600_000,
    };
    this.options.store?.set(APP_TOKEN_KEY, JSON.stringify(this.appToken));
    return tokens.accessToken;
  }

  isConfigured() {
    return Boolean(this.options.clientId && this.options.clientSecret);
  }

  /** App-level token for public catalogue requests (client credentials grant). */
  private async getAppToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.id, 'SoundCloud не настроен: задайте SOUNDCLOUD_CLIENT_ID и SOUNDCLOUD_CLIENT_SECRET');
    }
    if (!this.appToken) {
      try {
        const saved = this.options.store?.get(APP_TOKEN_KEY);
        if (saved) this.appToken = JSON.parse(saved);
      } catch {
        this.appToken = null;
      }
    }
    if (this.appToken && this.appToken.expiresAt - 60_000 > Date.now()) return this.appToken.token;
    this.appTokenRequest ??= this.requestAppToken().finally(() => (this.appTokenRequest = null));
    return this.appTokenRequest;
  }

  private async get<T>(pathOrUrl: string, userToken?: string | null): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
    const send = async (token: string) =>
      fetchJson<T>(this.fetchImpl, this.id, url, {
        headers: { authorization: `OAuth ${token}`, accept: 'application/json; charset=utf-8' },
      });
    try {
      return await send(userToken ?? (await this.getAppToken()));
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      if (err.code === 401 && !userToken) {
        // The cached app token was revoked early: get a new one once.
        this.appToken = null;
        return send(await this.getAppToken());
      }
      if (err.code === 401) throw new ProviderError(this.id, 'SoundCloud: вход устарел — подключите аккаунт заново', 401);
      if (err.code === 429) throw new ProviderError(this.id, 'SoundCloud: превышен лимит запросов, попробуйте позже', 429);
      if (err.code === 404) throw new ProviderError(this.id, 'SoundCloud: не найдено', 404);
      throw err;
    }
  }

  /** Follows `next_href` links until `max` items are collected. */
  private async collect<T>(path: string, userToken: string | null | undefined, max = MAX_IMPORT): Promise<T[]> {
    const items: T[] = [];
    let next: string | null | undefined = path;
    while (next && items.length < max) {
      const page: ScPage<T> = await this.get<ScPage<T>>(next, userToken);
      items.push(...page.collection);
      next = page.next_href;
    }
    return items.slice(0, max);
  }

  private mapUser(u: ScUser): ExternalArtist {
    const fans = formatFans(u.followers_count);
    const tracks = u.track_count ? `${u.track_count} треков` : null;
    return {
      externalId: u.urn ?? String(u.id),
      name: u.username,
      imageUrl: scArtwork(u.avatar_url),
      url: u.permalink_url ?? null,
      subtitle: [fans, tracks].filter(Boolean).join(' · ') || null,
    };
  }

  private mapTrack(t: ScTrack): ExternalTrack {
    return {
      externalId: t.urn ?? String(t.id),
      title: t.title,
      artist: t.user?.username ?? '',
      album: null,
      duration: Math.round(t.duration / 1000),
      streamUrl: null,
      coverUrl: scArtwork(t.artwork_url ?? t.user?.avatar_url),
      externalUrl: t.permalink_url ?? null,
      // Uploads are what "new" means on SoundCloud.
      releasedAt: parseScDate(t.created_at),
      genre: t.genre || null,
      isPreview: t.access === 'preview',
    };
  }

  private mapTracks(tracks: ScTrack[]): ExternalTrack[] {
    return tracks.filter((t) => t.streamable !== false && t.access !== 'blocked').map((t) => this.mapTrack(t));
  }

  async searchArtists(query: string): Promise<ExternalArtist[]> {
    const page = await this.get<ScPage<ScUser>>(`/users?${new URLSearchParams({ q: query, limit: '20', linked_partitioning: 'true' })}`);
    return page.collection.map((u) => this.mapUser(u));
  }

  async getArtistTracks(artist: ArtistRef): Promise<ExternalTrack[]> {
    const page = await this.get<ScPage<ScTrack>>(
      `/users/${encodeURIComponent(artist.externalId)}/tracks?${new URLSearchParams({
        limit: '50',
        linked_partitioning: 'true',
        access: 'playable,preview',
      })}`,
    );
    return this.mapTracks(page.collection).sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
  }

  async resolveStream(track: StoredExternalTrack): Promise<StreamSource | null> {
    const streams = await this.get<ScStreams>(`/tracks/${encodeURIComponent(track.externalId)}/streams`);
    const url = streams.http_mp3_128_url ?? streams.hls_mp3_128_url ?? streams.hls_aac_160_url ?? streams.preview_mp3_128_url;
    if (!url) return null;
    // Stream endpoints need the token and answer with a redirect to a signed CDN URL.
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { authorization: `OAuth ${await this.getAppToken()}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new ProviderError(this.id, `Сервис недоступен: ${(err as Error).message}`);
    }
    await res.body?.cancel().catch(() => {});
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) return { url: location, kind: streamKind(location) };
    throw new ProviderError(this.id, `SoundCloud не отдал поток (HTTP ${res.status})`, res.status);
  }

  async verifyToken(token: string) {
    const me = await this.get<ScUser>('/me', token);
    return { externalUserId: me.urn ?? String(me.id), displayName: me.full_name || me.username };
  }

  async getUserLibrary(ctx: ProviderContext): Promise<ExternalTrack[]> {
    if (!ctx.token) throw new ProviderError(this.id, 'Подключите аккаунт SoundCloud', 'no_token');
    const tracks = await this.collect<ScTrack>('/me/likes/tracks?limit=200&linked_partitioning=true', ctx.token);
    return this.mapTracks(tracks);
  }

  async getUserFollowings(ctx: ProviderContext): Promise<ExternalArtist[]> {
    if (!ctx.token) throw new ProviderError(this.id, 'Подключите аккаунт SoundCloud', 'no_token');
    const users = await this.collect<ScUser>('/me/followings?limit=200&linked_partitioning=true', ctx.token);
    return users.map((u) => this.mapUser(u));
  }
}
