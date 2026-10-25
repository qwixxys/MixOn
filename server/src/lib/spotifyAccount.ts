import crypto from 'node:crypto';
import type { DB } from '../db/index.js';
import { badRequest } from './errors.js';
import type { WantedSong } from './findSong.js';
import { ProviderError, type FetchLike } from './http.js';
import { MAX_SPOTIFY_TRACKS } from './spotify.js';

/**
 * A listener's own Spotify account, for what open links cannot reach: liked songs and private playlists. As Riff does
 * it, the listener registers a Spotify app of their own (developer.spotify.com) and signs in through it with PKCE, so
 * MixOn needs no secret of its own; only reading is asked for. The music itself still plays from the listener's
 * services, as with any Spotify playlist (lib/spotify.ts).
 */

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative';
/** Where Spotify sends the phone app back: Android opens MixOn for it (MainActivity). */
export const APP_REDIRECT = 'mixon://spotify-callback';
/** Where it sends a browser or the desktop app back: the server itself. */
export const CALLBACK_PATH = '/api/spotify/callback';
const LOGIN_TTL_MS = 30 * 60_000;
/** The account's row in service_connections; Spotify is no service to play from. */
const ROW = 'spotify';
const LOGIN_KEY = 'spotify_login:';
const CLIENT_KEY = 'spotify_client:';
const PAGE = 50;

interface PendingLogin {
  userId: number;
  clientId: string;
  verifier: string;
  redirectUri: string;
  expires: number;
}

interface TokenReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface SpotifyTrack {
  name?: string;
  type?: string;
  is_local?: boolean;
  duration_ms?: number;
  artists?: { name?: string }[];
}

/** A playlist or liked-songs entry; newer answers call the song `item`, older ones `track`. */
interface SpotifyItem {
  item?: SpotifyTrack | null;
  track?: SpotifyTrack | null;
}

interface Paged<T> {
  items?: T[];
  next?: string | null;
  total?: number;
}

interface SpotifyPlaylist {
  id: string;
  name?: string;
  images?: { url: string }[] | null;
  owner?: { display_name?: string };
  items?: { total?: number };
  tracks?: { total?: number };
}

/** A song of a list; nothing for podcast episodes and files on the listener's own computer. */
export function itemSong(entry: SpotifyItem): WantedSong | null {
  const t = entry.item ?? entry.track;
  if (!t?.name || t.is_local || (t.type && t.type !== 'track')) return null;
  return {
    title: t.name.trim(),
    artist: (t.artists ?? []).map((a) => a.name?.trim()).filter(Boolean).join(', '),
    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : 0,
  };
}

/** The address Spotify may send the listener back to: the phone app, or this server's callback. */
function allowedRedirect(uri: string): boolean {
  if (uri === APP_REDIRECT) return true;
  try {
    const url = new URL(uri);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname === CALLBACK_PATH && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export class SpotifyAccounts {
  private refreshing = new Map<number, Promise<string>>();

  constructor(
    private db: DB,
    private fetchImpl: FetchLike,
  ) {}

  private kv(key: string): string | null {
    return (this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }

  private setKv(key: string, value: string) {
    this.db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /**
   * The Spotify page to sign in on. The login is remembered in the database, not in memory: on the phone the app
   * reloads when Spotify sends the listener back to it.
   */
  start(userId: number, clientId: string, redirectUri: string): string {
    if (!/^[0-9a-f]{32}$/i.test(clientId)) throw badRequest('Client ID Spotify — это 32 символа из цифр и букв a–f');
    if (!allowedRedirect(redirectUri)) throw badRequest('Неверный адрес возврата для входа в Spotify');
    const keys = this.db.prepare(`SELECT key, value FROM app_state WHERE key LIKE '${LOGIN_KEY}%'`).all() as { key: string; value: string }[];
    for (const { key, value } of keys) {
      if ((JSON.parse(value) as PendingLogin).expires < Date.now()) this.db.prepare('DELETE FROM app_state WHERE key = ?').run(key);
    }
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const login: PendingLogin = { userId, clientId, verifier, redirectUri, expires: Date.now() + LOGIN_TTL_MS };
    this.setKv(LOGIN_KEY + state, JSON.stringify(login));
    this.setKv(CLIENT_KEY + userId, clientId);
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
      code_challenge_method: 'S256',
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    });
    return `${ACCOUNTS}/authorize?${query}`;
  }

  /** Finishes a sign-in Spotify sent back with `code`; the login it belongs to says whose account it is. */
  async finish(state: string, code: string | null, error: string | null): Promise<{ userId: number; displayName: string }> {
    const saved = this.kv(LOGIN_KEY + state);
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(LOGIN_KEY + state);
    const login = saved ? (JSON.parse(saved) as PendingLogin) : null;
    if (!login || login.expires < Date.now()) throw badRequest('Сессия входа устарела, попробуйте ещё раз');
    if (error || !code) throw badRequest('Spotify: вход отменён');
    const tokens = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: login.redirectUri,
      client_id: login.clientId,
      code_verifier: login.verifier,
    });
    if (!tokens.refresh_token) throw new ProviderError('spotify', 'Spotify не выдал токен');
    const me = await this.request<{ id?: string; display_name?: string }>(`${API}/me`, tokens.access_token!);
    const displayName = me.display_name || me.id || 'Spotify';
    this.db
      .prepare(
        `INSERT INTO service_connections (user_id, provider, access_token, refresh_token, expires_at, external_user_id, display_name, client_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, provider) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at, external_user_id = excluded.external_user_id, display_name = excluded.display_name,
           client_id = excluded.client_id, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(login.userId, ROW, tokens.access_token, tokens.refresh_token, expiry(tokens), me.id ?? null, displayName, login.clientId);
    return { userId: login.userId, displayName };
  }

  status(userId: number) {
    const row = this.db.prepare('SELECT display_name FROM service_connections WHERE user_id = ? AND provider = ?').get(userId, ROW) as
      | { display_name: string | null }
      | undefined;
    return { connected: Boolean(row), displayName: row?.display_name ?? null, clientId: this.kv(CLIENT_KEY + userId) };
  }

  disconnect(userId: number) {
    this.db.prepare('DELETE FROM service_connections WHERE user_id = ? AND provider = ?').run(userId, ROW);
  }

  /** The listener's playlists (their own and the ones they follow) and how many songs they liked. */
  async library(userId: number) {
    const liked = await this.get<Paged<unknown>>(userId, `${API}/me/tracks?limit=1`);
    const playlists: SpotifyPlaylist[] = [];
    for (let url: string | null = `${API}/me/playlists?limit=${PAGE}`; url && playlists.length < 500; ) {
      const page: Paged<SpotifyPlaylist | null> = await this.get(userId, url);
      playlists.push(...(page.items ?? []).filter((p): p is SpotifyPlaylist => Boolean(p?.id)));
      url = page.next ?? null;
    }
    return {
      liked: liked.total ?? 0,
      playlists: playlists.map((p) => ({
        id: p.id,
        name: p.name || 'Spotify',
        total: p.items?.total ?? p.tracks?.total ?? 0,
        image: p.images?.[0]?.url ?? null,
        owner: p.owner?.display_name ?? null,
      })),
    };
  }

  /** Liked songs (`'liked'`, newest first) or a playlist's songs, up to MAX_SPOTIFY_TRACKS, with the list's size. */
  async songs(userId: number, list: string): Promise<{ title: string; tracks: WantedSong[]; total: number; url: string }> {
    if (list === 'liked') {
      const read = await this.pages(userId, `${API}/me/tracks?limit=${PAGE}`);
      return { title: 'Spotify: любимые треки', ...read, url: 'https://open.spotify.com/collection/tracks' };
    }
    if (!/^[A-Za-z0-9]{22}$/.test(list)) throw badRequest('Неверный плейлист Spotify');
    const playlist = await this.get<SpotifyPlaylist>(userId, `${API}/playlists/${list}?fields=id,name`);
    // Newer apps read a playlist's songs at /items, older ones at /tracks.
    let read;
    try {
      read = await this.pages(userId, `${API}/playlists/${list}/items?limit=${PAGE}`);
    } catch (err) {
      if (!(err instanceof ProviderError) || (err.code !== 404 && err.code !== 400)) throw err;
      read = await this.pages(userId, `${API}/playlists/${list}/tracks?limit=${PAGE}`);
    }
    return { title: playlist.name || 'Spotify', ...read, url: `https://open.spotify.com/playlist/${list}` };
  }

  private async pages(userId: number, first: string) {
    const tracks: WantedSong[] = [];
    let total = 0;
    for (let url: string | null = first; url && tracks.length < MAX_SPOTIFY_TRACKS; ) {
      const page: Paged<SpotifyItem> = await this.get(userId, url);
      total = page.total ?? total;
      for (const entry of page.items ?? []) {
        const song = itemSong(entry);
        if (song) tracks.push(song);
      }
      url = page.next ?? null;
    }
    return { tracks: tracks.slice(0, MAX_SPOTIFY_TRACKS), total: Math.max(total, tracks.length) };
  }

  private async get<T>(userId: number, url: string): Promise<T> {
    return this.request<T>(url, await this.token(userId));
  }

  /** A current access token, refreshed when it is about to run out; two requests at once refresh once. */
  private async token(userId: number): Promise<string> {
    const row = this.db
      .prepare('SELECT access_token, refresh_token, expires_at, client_id FROM service_connections WHERE user_id = ? AND provider = ?')
      .get(userId, ROW) as { access_token: string; refresh_token: string | null; expires_at: string | null; client_id: string | null } | undefined;
    if (!row) throw badRequest('Войдите в Spotify на странице «Сервисы»');
    if (!row.expires_at || Date.parse(row.expires_at) - 60_000 > Date.now()) return row.access_token;
    if (!row.refresh_token || !row.client_id) throw badRequest('Вход в Spotify устарел, войдите снова');
    let job = this.refreshing.get(userId);
    if (!job) {
      job = this.requestToken({ grant_type: 'refresh_token', refresh_token: row.refresh_token, client_id: row.client_id })
        .then((t) => {
          this.db
            .prepare(
              `UPDATE service_connections SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ?
               WHERE user_id = ? AND provider = ?`,
            )
            .run(t.access_token, t.refresh_token ?? null, expiry(t), userId, ROW);
          return t.access_token!;
        })
        .catch((err: Error) => {
          // A refresh token Spotify no longer accepts will not work later either.
          if (err instanceof ProviderError && err.code === 'invalid_grant') this.disconnect(userId);
          throw err;
        })
        .finally(() => this.refreshing.delete(userId));
      this.refreshing.set(userId, job);
    }
    return job;
  }

  private async requestToken(params: Record<string, string>): Promise<TokenReply> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderError('spotify', `Spotify недоступен: ${(err as Error).message}`);
    }
    const reply = (await res.json().catch(() => ({}))) as TokenReply;
    if (reply.error === 'invalid_grant') throw new ProviderError('spotify', 'Вход в Spotify устарел, войдите снова', 'invalid_grant');
    if (reply.error === 'invalid_client') {
      throw new ProviderError('spotify', 'Spotify не узнал Client ID: проверьте его и адрес возврата в настройках приложения Spotify');
    }
    if (!res.ok || !reply.access_token) {
      throw new ProviderError('spotify', `Spotify не дал войти: ${reply.error_description || reply.error || `HTTP ${res.status}`}`, res.status);
    }
    return reply;
  }

  private async request<T>(url: string, token: string, retried = false): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new ProviderError('spotify', `Spotify недоступен: ${(err as Error).message}`);
    }
    // Too many requests: wait as long as Spotify asks, once, if that is not long.
    const wait = Number(res.headers.get('retry-after'));
    if (res.status === 429 && !retried && wait <= 5) {
      await new Promise((r) => setTimeout(r, Math.max(wait, 1) * 1000));
      return this.request(url, token, true);
    }
    if (res.status === 403) {
      throw new ProviderError(
        'spotify',
        'Spotify не дал доступ: добавьте свой аккаунт в User Management своего приложения Spotify. Плейлисты, которые составляет сам Spotify, сторонним приложениям закрыты',
        403,
      );
    }
    if (!res.ok) throw new ProviderError('spotify', `Spotify ответил ошибкой HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  }
}

const expiry = (t: TokenReply) => new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString();
