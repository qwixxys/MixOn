import type { DB } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { normalizeGenre } from '../lib/genres.js';
import type { ExternalTrack, OAuthTokens, ProviderRegistry } from '../providers/index.js';

/** Tracks older than this are imported silently instead of producing a "new release" notification. */
const NOTIFY_MAX_AGE_DAYS = 30;

export interface ArtistSyncResult {
  artistId: number;
  name: string;
  provider: string;
  fetched: number;
  newTracks: number;
  error: string | null;
}

export interface SyncSummary {
  artists: number;
  newTracks: number;
  errors: { artistId: number; name: string; provider: string; error: string }[];
}

interface ArtistRow {
  id: number;
  provider: string;
  external_id: string;
  name: string;
  last_synced_at: string | null;
}

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

export class SyncService {
  private inflight = new Map<number, Promise<ArtistSyncResult>>();
  private timers: NodeJS.Timeout[] = [];
  private syncingAll: Promise<SyncSummary> | null = null;
  private refreshing = new Map<string, Promise<string | null>>();

  constructor(
    private db: DB,
    private providers: ProviderRegistry,
    private log: Logger = console,
  ) {}

  /** A user's own token for a provider, refreshed first if it has expired. */
  async userToken(provider: string, userId: number | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const row = this.db
      .prepare('SELECT access_token, refresh_token, expires_at FROM service_connections WHERE user_id = ? AND provider = ?')
      .get(userId, provider) as { access_token: string; refresh_token: string | null; expires_at: string | null } | undefined;
    if (!row) return null;
    const flow = this.providers.find(provider)?.oauth;
    const expired = row.expires_at !== null && Date.parse(row.expires_at) - 60_000 <= Date.now();
    if (!expired || !row.refresh_token || !flow) return row.access_token;

    // Refresh tokens are single-use, so concurrent callers share one refresh.
    const key = `${provider}:${userId}`;
    let job = this.refreshing.get(key);
    if (!job) {
      job = flow
        .refresh(row.refresh_token)
        .then((t) => {
          this.db
            .prepare(
              `UPDATE service_connections SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ?
               WHERE user_id = ? AND provider = ?`,
            )
            .run(t.accessToken, t.refreshToken, t.expiresAt, userId, provider);
          return t.accessToken;
        })
        .catch((err: Error) => {
          this.log.warn(`[sync] ${provider}: не удалось обновить токен пользователя ${userId}: ${err.message}`);
          return null;
        })
        .finally(() => this.refreshing.delete(key));
      this.refreshing.set(key, job);
    }
    return job;
  }

  /** Saves the token a user linked, by pasting it or through OAuth. */
  saveConnection(userId: number, provider: string, tokens: OAuthTokens, account: { externalUserId: string; displayName: string }) {
    this.db
      .prepare(
        `INSERT INTO service_connections (user_id, provider, access_token, refresh_token, expires_at, external_user_id, display_name)
         VALUES (@userId, @provider, @accessToken, @refreshToken, @expiresAt, @externalUserId, @displayName)
         ON CONFLICT (user_id, provider) DO UPDATE SET access_token = excluded.access_token,
           refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
           external_user_id = excluded.external_user_id, display_name = excluded.display_name,
           created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run({ userId, provider, ...tokens, ...account });
  }

  /** Token to sync an artist with: the requesting user's, otherwise any subscriber's. */
  private async artistToken(provider: string, artistId: number, userId?: number | null): Promise<string | null> {
    const own = await this.userToken(provider, userId);
    if (own) return own;
    const row = this.db
      .prepare(
        `SELECT sc.user_id FROM subscriptions s
         JOIN service_connections sc ON sc.user_id = s.user_id AND sc.provider = ?
         WHERE s.external_artist_id = ? ORDER BY s.created_at LIMIT 1`,
      )
      .get(provider, artistId) as { user_id: number } | undefined;
    return row ? this.userToken(provider, row.user_id) : null;
  }

  /** Creates or updates an external artist record and returns its id. */
  upsertArtist(provider: string, artist: { externalId: string; name: string; imageUrl?: string | null; url?: string | null }): number {
    this.db
      .prepare(
        `INSERT INTO external_artists (provider, external_id, name, image_url, url) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider, external_id) DO UPDATE SET name = excluded.name,
           image_url = COALESCE(excluded.image_url, image_url), url = COALESCE(excluded.url, url)`,
      )
      .run(provider, artist.externalId, artist.name, artist.imageUrl ?? null, artist.url ?? null);
    const { id } = this.db
      .prepare('SELECT id FROM external_artists WHERE provider = ? AND external_id = ?')
      .get(provider, artist.externalId) as { id: number };
    return id;
  }

  /**
   * Inserts or refreshes external tracks. Returns ids of all given tracks and of the ones that are new to `artistId`:
   * just created, or known before (say, from an imported playlist) but not yet linked to the artist.
   */
  storeTracks(tracks: ExternalTrack[], source: string, artistId: number | null): { ids: number[]; newIds: number[] } {
    const find = this.db.prepare('SELECT id, external_artist_id FROM tracks WHERE source = ? AND external_id = ?');
    // Playlist listings can lack what the artist's own catalogue has (Deezer gives no release date or genre there).
    const update = this.db.prepare(
      `UPDATE tracks SET stream_url = @streamUrl, cover_url = COALESCE(@coverUrl, cover_url), extra = @extra,
         external_artist_id = COALESCE(external_artist_id, @artistId), released_at = COALESCE(released_at, @releasedAt),
         genre = COALESCE(genre, @genre), album = COALESCE(album, @album)
       WHERE id = @id`,
    );
    const insert = this.db.prepare(
      `INSERT INTO tracks (source, external_id, external_artist_id, title, artist, album, genre, duration,
         stream_url, cover_url, external_url, is_preview, released_at, extra)
       VALUES (@source, @externalId, @artistId, @title, @artist, @album, @genre, @duration,
         @streamUrl, @coverUrl, @externalUrl, @isPreview, @releasedAt, @extra)`,
    );

    const ids: number[] = [];
    const newIds: number[] = [];
    this.db.transaction(() => {
      for (const t of tracks) {
        const extra = t.extra ? JSON.stringify(t.extra) : null;
        const existing = find.get(source, t.externalId) as { id: number; external_artist_id: number | null } | undefined;
        if (existing) {
          update.run({
            id: existing.id,
            streamUrl: t.streamUrl,
            coverUrl: t.coverUrl,
            extra,
            artistId,
            releasedAt: t.releasedAt,
            genre: normalizeGenre(t.genre),
            album: t.album,
          });
          ids.push(existing.id);
          if (artistId !== null && existing.external_artist_id === null) newIds.push(existing.id);
          continue;
        }
        const { lastInsertRowid } = insert.run({
          source,
          externalId: t.externalId,
          artistId,
          title: t.title,
          artist: t.artist,
          album: t.album,
          genre: normalizeGenre(t.genre),
          duration: t.duration,
          streamUrl: t.streamUrl,
          coverUrl: t.coverUrl,
          externalUrl: t.externalUrl,
          isPreview: t.isPreview ? 1 : 0,
          releasedAt: t.releasedAt,
          extra,
        });
        ids.push(Number(lastInsertRowid));
        newIds.push(Number(lastInsertRowid));
      }
    })();
    return { ids, newIds };
  }

  syncArtist(artistId: number, userId?: number | null): Promise<ArtistSyncResult> {
    const running = this.inflight.get(artistId);
    if (running) return running;
    const job = this.doSyncArtist(artistId, userId).finally(() => this.inflight.delete(artistId));
    this.inflight.set(artistId, job);
    return job;
  }

  private async doSyncArtist(artistId: number, userId?: number | null): Promise<ArtistSyncResult> {
    const artist = this.db.prepare('SELECT * FROM external_artists WHERE id = ?').get(artistId) as
      | ArtistRow
      | undefined;
    if (!artist) throw notFound('Артист не найден');
    const result: ArtistSyncResult = {
      artistId,
      name: artist.name,
      provider: artist.provider,
      fetched: 0,
      newTracks: 0,
      error: null,
    };

    try {
      const provider = this.providers.get(artist.provider);
      const token = provider.requiresToken ? await this.artistToken(provider.id, artistId, userId) : null;
      const tracks = await provider.getArtistTracks({ externalId: artist.external_id, name: artist.name }, { token });
      const { newIds } = this.storeTracks(tracks, provider.id, artistId);
      result.fetched = tracks.length;
      result.newTracks = newIds.length;

      // The first sync imports the back catalogue; only later discoveries are "new releases".
      if (artist.last_synced_at && newIds.length) this.notifySubscribers(artistId, newIds);

      this.db
        .prepare(
          `UPDATE external_artists SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = NULL WHERE id = ?`,
        )
        .run(artistId);
    } catch (err) {
      result.error = (err as Error).message;
      this.db.prepare('UPDATE external_artists SET last_error = ? WHERE id = ?').run(result.error, artistId);
      this.log.warn(`[sync] ${artist.provider}/${artist.name}: ${result.error}`);
    }
    return result;
  }

  private notifySubscribers(artistId: number, trackIds: number[]) {
    const cutoff = new Date(Date.now() - NOTIFY_MAX_AGE_DAYS * 86400_000).toISOString();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO notifications (user_id, track_id, type)
       SELECT s.user_id, t.id, 'new_release' FROM subscriptions s, tracks t
       WHERE s.external_artist_id = @artistId AND t.id = @trackId
         AND (t.released_at IS NULL OR t.released_at >= @cutoff)`,
    );
    this.db.transaction(() => {
      for (const trackId of trackIds) stmt.run({ artistId, trackId, cutoff });
    })();
  }

  private summarize(results: ArtistSyncResult[]): SyncSummary {
    return {
      artists: results.length,
      newTracks: results.reduce((sum, r) => sum + r.newTracks, 0),
      errors: results
        .filter((r) => r.error)
        .map((r) => ({ artistId: r.artistId, name: r.name, provider: r.provider, error: r.error! })),
    };
  }

  /** Syncs every artist the user is subscribed to. */
  async syncUser(userId: number): Promise<SyncSummary> {
    const artists = this.db
      .prepare('SELECT external_artist_id AS id FROM subscriptions WHERE user_id = ?')
      .all(userId) as { id: number }[];
    const results: ArtistSyncResult[] = [];
    for (const { id } of artists) results.push(await this.syncArtist(id, userId));
    return this.summarize(results);
  }

  /** Syncs every artist that has at least one subscriber. Concurrent calls share one run. */
  syncAll(): Promise<SyncSummary> {
    if (!this.syncingAll) {
      this.syncingAll = (async () => {
        const artists = this.db
          .prepare('SELECT DISTINCT external_artist_id AS id FROM subscriptions')
          .all() as { id: number }[];
        const results: ArtistSyncResult[] = [];
        for (const { id } of artists) results.push(await this.syncArtist(id));
        return this.summarize(results);
      })().finally(() => {
        this.syncingAll = null;
      });
    }
    return this.syncingAll;
  }

  /** Imports the user's own library from a service into a playlist. */
  async importLibrary(userId: number, providerId: string) {
    const provider = this.providers.get(providerId);
    if (!provider.getUserLibrary) throw badRequest(`${provider.name} не поддерживает импорт библиотеки`);
    const token = await this.userToken(provider.id, userId);
    if (provider.connectMode && !token) throw badRequest(`Сначала подключите ${provider.name}`);

    const tracks = await provider.getUserLibrary({ token });
    const { ids, newIds } = this.storeTracks(tracks, provider.id, null);

    const title = `${provider.name}: ${provider.libraryLabel ?? 'мои треки'}`;
    const playlistId = this.savePlaylist(userId, title, `Импортировано из ${provider.name}`, ids);
    return { playlistId, imported: ids.length, newTracks: newIds.length };
  }

  /** Imports a public playlist or album by its link into a private playlist. Importing the same link again tops it up. */
  async importFromUrl(userId: number, url: URL) {
    const matching = this.providers.list().filter((p) => p.canImport?.(url));
    const provider = matching.find((p) => p.isConfigured());
    if (!provider?.importPlaylist) {
      if (matching.length) throw badRequest(`${matching[0].name} не настроен на сервере`);
      throw badRequest('Такие ссылки пока не поддерживаются: подойдут плейлисты и альбомы Deezer или плейлисты SoundCloud');
    }

    const playlist = await provider.importPlaylist(url, { token: await this.userToken(provider.id, userId) });
    if (!playlist.tracks.length) throw badRequest(`В «${playlist.title}» нет треков, которые можно слушать`);
    const { ids, newIds } = this.storeTracks(playlist.tracks, provider.id, null);

    const title = playlist.title.trim().slice(0, 100) || `${provider.name}: плейлист`;
    // The source line identifies the playlist when the same link is imported again.
    const source = `Импортировано из ${provider.name}: ${playlist.url}`;
    const description = [playlist.description?.trim().slice(0, 2000 - source.length - 2), source].filter(Boolean).join('\n\n');
    const playlistId = this.savePlaylist(userId, title, description, ids, source);
    return { playlistId, title, imported: ids.length, fetched: playlist.fetched, total: playlist.total, newTracks: newIds.length };
  }

  /**
   * Appends tracks to the user's private playlist, creating it first. An existing playlist is found by its title,
   * or, when `marker` is given, by a description ending with it.
   */
  private savePlaylist(userId: number, title: string, description: string, trackIds: number[], marker?: string): number {
    return this.db.transaction(() => {
      const existing = (
        marker
          ? this.db
              .prepare(`SELECT id FROM playlists WHERE user_id = ? AND substr(description, -length(?)) = ? ORDER BY id LIMIT 1`)
              .get(userId, marker, marker)
          : this.db.prepare('SELECT id FROM playlists WHERE user_id = ? AND title = ?').get(userId, title)
      ) as { id: number } | undefined;
      const id =
        existing?.id ??
        Number(
          this.db
            .prepare('INSERT INTO playlists (user_id, title, description, is_public) VALUES (?, ?, ?, 0)')
            .run(userId, title, description).lastInsertRowid,
        );
      const { pos } = this.db
        .prepare('SELECT COALESCE(MAX(position), -1) AS pos FROM playlist_tracks WHERE playlist_id = ?')
        .get(id) as { pos: number };
      const add = this.db.prepare(
        'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
      );
      let next = pos + 1;
      for (const trackId of trackIds) {
        if (add.run(id, trackId, next).changes) next++;
      }
      this.db.prepare(`UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(id);
      return id;
    })();
  }

  /** Subscribes the user to everyone they follow on a service; catalogues are imported in the background. */
  async importFollowings(userId: number, providerId: string) {
    const provider = this.providers.get(providerId);
    if (!provider.getUserFollowings) throw badRequest(`${provider.name} не поддерживает импорт подписок`);
    const token = await this.userToken(provider.id, userId);
    if (!token) throw badRequest(`Сначала подключите ${provider.name}`);

    const artists = await provider.getUserFollowings({ token });
    const subscribe = this.db.prepare('INSERT OR IGNORE INTO subscriptions (user_id, external_artist_id) VALUES (?, ?)');
    const subscribed = this.db.transaction(() => {
      let count = 0;
      for (const artist of artists) count += subscribe.run(userId, this.upsertArtist(provider.id, artist)).changes;
      return count;
    })();
    if (subscribed) {
      this.syncUser(userId).catch((err) => this.log.error('[sync] import followings', err));
    }
    return { found: artists.length, subscribed };
  }

  start(intervalMinutes: number) {
    if (intervalMinutes <= 0) return;
    const run = () => {
      this.syncAll()
        .then((s) => {
          if (s.artists) this.log.info(`[sync] ${s.artists} artists checked, ${s.newTracks} new tracks`);
        })
        .catch((err) => this.log.error('[sync] failed', err));
    };
    this.timers.push(setTimeout(run, 15_000).unref(), setInterval(run, intervalMinutes * 60_000).unref());
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
