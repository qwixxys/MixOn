import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ProviderError } from '../lib/http.js';
import { queryTracks } from '../lib/tracks.js';
import { idParam, parse } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';
import type { MusicProvider } from '../providers/index.js';

const connectSchema = z.object({ accessToken: z.string().trim().min(10, 'вставьте токен').max(2000) });
const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => /^https?:\/\/[^\s]+$/i.test(u), 'нужна ссылка http(s)');
const subscribeSchema = z.object({
  provider: z.string().min(1),
  externalId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  imageUrl: httpUrl.nullish(),
  url: httpUrl.nullish(),
});

/** Accepts either a bare token or the whole OAuth redirect URL (…#access_token=…&expires_in=…). */
export function extractToken(input: string): string {
  const match = input.match(/access_token=([^&\s]+)/);
  return match ? decodeURIComponent(match[1]) : input;
}

interface ArtistRow {
  id: number;
  provider: string;
  external_id: string;
  name: string;
  image_url: string | null;
  url: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  track_count: number;
  latest_release: string | null;
  subscribers: number;
  subscribed_at?: string | null;
  is_subscribed?: number;
}

function toArtist(row: ArtistRow) {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_id,
    name: row.name,
    imageUrl: row.image_url,
    url: row.url,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    trackCount: row.track_count,
    latestReleaseAt: row.latest_release,
    subscribers: row.subscribers,
    subscribedAt: row.subscribed_at ?? null,
    isSubscribed: Boolean(row.is_subscribed ?? row.subscribed_at),
  };
}

const ARTIST_SELECT = `
  SELECT ea.*,
    (SELECT COUNT(*) FROM tracks t WHERE t.external_artist_id = ea.id) AS track_count,
    (SELECT MAX(t.released_at) FROM tracks t WHERE t.external_artist_id = ea.id) AS latest_release,
    (SELECT COUNT(*) FROM subscriptions s WHERE s.external_artist_id = ea.id) AS subscribers
  FROM external_artists ea`;

export function serviceRoutes(ctx: AppContext) {
  const r = Router();
  const { db, providers, sync, config } = ctx;

  const describe = (p: MusicProvider, userId: number | undefined) => {
    const connection = userId
      ? (db
          .prepare('SELECT display_name, created_at FROM service_connections WHERE user_id = ? AND provider = ?')
          .get(userId, p.id) as { display_name: string | null; created_at: string } | undefined)
      : undefined;
    const serverToken = p.id === 'vk' && Boolean(config.vk.accessToken);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      requiresToken: p.requiresToken,
      fullTracks: p.fullTracks,
      configured: p.isConfigured(),
      connected: Boolean(connection),
      account: connection ? { displayName: connection.display_name, connectedAt: connection.created_at } : null,
      serverToken,
      available: p.isConfigured() && (!p.requiresToken || Boolean(connection) || serverToken),
      canImportLibrary: Boolean(p.getUserLibrary),
    };
  };

  r.get('/services', (req, res) => {
    res.json(providers.list().map((p) => describe(p, req.userId)));
  });

  r.post('/services/:id/connect', async (req, res) => {
    const me = requireUser(req);
    const provider = providers.get(req.params.id);
    if (!provider.verifyToken) throw badRequest(`${provider.name} не требует подключения аккаунта`);
    const token = extractToken(parse(connectSchema, req.body).accessToken);
    const account = await provider.verifyToken(token);
    db.prepare(
      `INSERT INTO service_connections (user_id, provider, access_token, external_user_id, display_name)
       VALUES (@me, @provider, @token, @externalUserId, @displayName)
       ON CONFLICT (user_id, provider) DO UPDATE SET access_token = excluded.access_token,
         external_user_id = excluded.external_user_id, display_name = excluded.display_name,
         created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).run({ me, provider: provider.id, token, ...account });
    res.json(describe(provider, me));
  });

  r.delete('/services/:id/connect', (req, res) => {
    const me = requireUser(req);
    const provider = providers.get(req.params.id);
    db.prepare('DELETE FROM service_connections WHERE user_id = ? AND provider = ?').run(me, provider.id);
    res.json(describe(provider, me));
  });

  r.get('/services/:id/artists', async (req, res) => {
    const provider = providers.get(req.params.id);
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json([]);
    if (!provider.isConfigured()) throw badRequest(`${provider.name} не настроен на сервере`);
    const token = sync.userToken(provider.id, req.userId);
    const found = await provider.searchArtists(q, { token });
    const known = db.prepare(
      `SELECT ea.id, EXISTS (SELECT 1 FROM subscriptions s WHERE s.external_artist_id = ea.id AND s.user_id = ?) AS subscribed
       FROM external_artists ea WHERE ea.provider = ? AND ea.external_id = ?`,
    );
    res.json(
      found.map((a) => {
        const row = known.get(req.userId ?? 0, provider.id, a.externalId) as
          | { id: number; subscribed: number }
          | undefined;
        return { ...a, provider: provider.id, artistId: row?.id ?? null, isSubscribed: Boolean(row?.subscribed) };
      }),
    );
  });

  r.post('/services/:id/import', async (req, res) => {
    const me = requireUser(req);
    res.json(await sync.importLibrary(me, providers.get(req.params.id).id));
  });

  // ---------- subscriptions ----------

  r.get('/subscriptions', (req, res) => {
    const me = requireUser(req);
    const rows = db
      .prepare(
        `${ARTIST_SELECT.replace('FROM external_artists ea', ', s.created_at AS subscribed_at FROM external_artists ea')}
         JOIN subscriptions s ON s.external_artist_id = ea.id AND s.user_id = ?
         ORDER BY ea.name COLLATE NOCASE`,
      )
      .all(me) as ArtistRow[];
    res.json(rows.map(toArtist));
  });

  r.post('/subscriptions', async (req, res) => {
    const me = requireUser(req);
    const input = parse(subscribeSchema, req.body);
    const provider = providers.get(input.provider);
    if (!provider.isConfigured()) throw badRequest(`${provider.name} не настроен на сервере`);

    const artistId = db.transaction(() => {
      db.prepare(
        `INSERT INTO external_artists (provider, external_id, name, image_url, url) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider, external_id) DO UPDATE SET name = excluded.name,
           image_url = COALESCE(excluded.image_url, image_url), url = COALESCE(excluded.url, url)`,
      ).run(provider.id, input.externalId, input.name, input.imageUrl ?? null, input.url ?? null);
      const { id } = db
        .prepare('SELECT id FROM external_artists WHERE provider = ? AND external_id = ?')
        .get(provider.id, input.externalId) as { id: number };
      db.prepare('INSERT OR IGNORE INTO subscriptions (user_id, external_artist_id) VALUES (?, ?)').run(me, id);
      return id;
    })();

    const result = await sync.syncArtist(artistId, me);
    const row = db.prepare(`${ARTIST_SELECT} WHERE ea.id = ?`).get(artistId) as ArtistRow;
    res.status(201).json({ artist: toArtist({ ...row, is_subscribed: 1 }), sync: result });
  });

  r.delete('/subscriptions/:artistId', (req, res) => {
    const me = requireUser(req);
    db.prepare('DELETE FROM subscriptions WHERE user_id = ? AND external_artist_id = ?').run(
      me,
      idParam(req.params.artistId),
    );
    res.json({ ok: true });
  });

  r.post('/sync', async (req, res) => {
    const me = requireUser(req);
    res.json(await sync.syncUser(me));
  });

  // ---------- external artist pages ----------

  const loadArtist = (id: number, viewer: number | undefined) => {
    const row = db
      .prepare(
        `${ARTIST_SELECT.replace(
          'FROM external_artists ea',
          ', EXISTS (SELECT 1 FROM subscriptions s WHERE s.external_artist_id = ea.id AND s.user_id = @viewer) AS is_subscribed FROM external_artists ea',
        )} WHERE ea.id = @id`,
      )
      .get({ id, viewer: viewer ?? 0 }) as ArtistRow | undefined;
    if (!row) throw notFound('Артист не найден');
    return toArtist(row);
  };

  r.get('/artists/:id', (req, res) => {
    const artist = loadArtist(idParam(req.params.id), req.userId);
    const tracks = queryTracks(
      db,
      'WHERE t.external_artist_id = @id ORDER BY t.released_at DESC, t.id DESC LIMIT 200',
      { id: artist.id },
      req.userId,
    );
    res.json({ ...artist, tracks });
  });

  r.post('/artists/:id/sync', async (req, res) => {
    const me = requireUser(req);
    const id = idParam(req.params.id);
    loadArtist(id, me);
    const result = await sync.syncArtist(id, me);
    if (result.error) throw new ProviderError(result.provider, result.error);
    res.json(result);
  });

  return r;
}
