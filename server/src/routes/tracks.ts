import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { parseFile } from 'music-metadata';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { downloadAudio, type AudioFile } from '../lib/download.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { ProviderError } from '../lib/http.js';
import { normalizeGenre } from '../lib/genres.js';
import { cleanTitle, closeness, normalizeText, songQuery } from '../lib/matching.js';
import { listOptions, listTracks, resolveScope } from '../lib/trackLists.js';
import { getTrack, getTrackRow, queryTracks, avatarUrl, type TrackRow } from '../lib/tracks.js';
import { AUDIO_TYPES, createUploader, removeUpload, uploadDir, withUploads } from '../lib/uploads.js';
import { idParam, parse } from '../lib/validate.js';
import { normalizeWaveform } from '../lib/waveform.js';
import { requireUser } from '../middleware/auth.js';
import { signedUrlExpiry, type StreamSource } from '../providers/index.js';

const STREAM_CACHE_TTL_MS = 10 * 60_000;
const STREAM_TOKEN_TTL = '6h';
const PLAY_DEDUPE_SECONDS = 30;

const trackFields = {
  title: z.string().trim().min(1, 'укажите название').max(200),
  artist: z.string().trim().max(200),
  description: z.string().trim().max(5000),
  genre: z.string().trim().max(50),
};
const uploadSchema = z.object({
  title: trackFields.title.optional(),
  artist: trackFields.artist.optional(),
  description: trackFields.description.optional(),
  genre: trackFields.genre.optional(),
  duration: z.coerce.number().min(0).max(86400).optional(),
  waveform: z.string().max(20000).optional(),
});
const updateSchema = z.object({
  title: trackFields.title.optional(),
  artist: trackFields.artist.optional(),
  description: trackFields.description.optional(),
  genre: trackFields.genre.optional(),
});
const commentSchema = z.object({
  body: z.string().trim().min(1, 'комментарий пуст').max(500),
  atSeconds: z.number().min(0).max(86400).nullable().optional(),
});

const IMAGE_EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function nonEmpty(value: string | undefined) {
  return value && value.length ? value : undefined;
}

export function trackRoutes(ctx: AppContext) {
  const r = Router();
  const { db, config, providers, sync } = ctx;
  const upload = createUploader(config);
  const streamCache = new Map<string, { source: StreamSource; expires: number }>();

  const requireTrack = (id: number): TrackRow => {
    const row = getTrackRow(db, id);
    if (!row) throw notFound('Трек не найден');
    return row;
  };

  // ---------- listing ----------

  /** The whole catalogue, optionally one source: ?source=local|external|<provider>&genre=…&sort=… */
  r.get('/', (req, res) => {
    const source = typeof req.query.source === 'string' && req.query.source ? `source:${req.query.source}` : 'all';
    res.json(listTracks(db, resolveScope(db, source, req.userId), listOptions(req.query), req.query, req.userId));
  });

  r.get('/:id', (req, res) => {
    const track = getTrack(db, idParam(req.params.id), req.userId);
    if (!track) throw notFound('Трек не найден');
    res.json(track);
  });

  r.get('/:id/related', (req, res) => {
    const row = requireTrack(idParam(req.params.id));
    res.json(
      queryTracks(
        db,
        `WHERE t.id <> @id AND (
           (@userId IS NOT NULL AND t.user_id = @userId)
           OR (@artistId IS NOT NULL AND t.external_artist_id = @artistId)
           OR t.artist = @artist COLLATE NOCASE
           OR (@genre IS NOT NULL AND t.genre = @genre COLLATE NOCASE))
         ORDER BY (t.artist = @artist COLLATE NOCASE) DESC, COALESCE(t.released_at, t.created_at) DESC LIMIT 8`,
        { id: row.id, userId: row.user_id, artistId: row.external_artist_id, artist: row.artist, genre: row.genre },
        req.userId,
      ),
    );
  });

  // ---------- upload / edit ----------

  r.post(
    '/',
    upload.fields([
      { name: 'audio', maxCount: 1 },
      { name: 'cover', maxCount: 1 },
    ]),
    withUploads(async (req, res) => {
      const me = requireUser(req);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const audio = files?.audio?.[0];
      const cover = files?.cover?.[0];
      if (!audio) throw badRequest('Прикрепите аудиофайл');
      const input = parse(uploadSchema, req.body ?? {});

      let meta: Awaited<ReturnType<typeof parseFile>> | null = null;
      try {
        meta = await parseFile(audio.path, { duration: true });
      } catch {
        // Unreadable tags are fine: we fall back to client-provided values.
      }

      let coverName = cover?.filename ?? null;
      const picture = meta?.common.picture?.[0];
      if (!coverName && picture && IMAGE_EXT[picture.format]) {
        coverName = `${crypto.randomBytes(12).toString('hex')}${IMAGE_EXT[picture.format]}`;
        fs.writeFileSync(path.join(uploadDir(config, 'covers'), coverName), picture.data);
      }

      const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(me) as { display_name: string };
      let waveform: number[] | null = null;
      if (input.waveform) {
        try {
          waveform = normalizeWaveform(JSON.parse(input.waveform));
        } catch {
          waveform = null;
        }
      }
      const title =
        nonEmpty(input.title) ?? meta?.common.title ?? path.parse(audio.originalname).name.slice(0, 200) ?? 'Без названия';

      const id = db.transaction(() => {
        const { lastInsertRowid } = db
          .prepare(
            `INSERT INTO tracks (user_id, source, title, artist, description, genre, duration, audio_path, audio_mime,
               cover_path, waveform)
             VALUES (@userId, 'local', @title, @artist, @description, @genre, @duration, @audioPath, @audioMime,
               @coverPath, @waveform)`,
          )
          .run({
            userId: me,
            title,
            artist: nonEmpty(input.artist) ?? meta?.common.artist ?? user.display_name,
            description: input.description ?? '',
            genre: normalizeGenre(nonEmpty(input.genre) ?? meta?.common.genre?.[0]),
            duration: meta?.format.duration ?? input.duration ?? 0,
            audioPath: audio.filename,
            audioMime: audio.mimetype,
            coverPath: coverName,
            waveform: waveform ? JSON.stringify(waveform) : null,
          });
        const trackId = Number(lastInsertRowid);
        db.prepare(
          `INSERT OR IGNORE INTO notifications (user_id, track_id, type)
           SELECT follower_id, ?, 'new_upload' FROM follows WHERE followee_id = ?`,
        ).run(trackId, me);
        return trackId;
      })();

      res.status(201).json(getTrack(db, id, me));
    }),
  );

  r.patch(
    '/:id',
    upload.single('cover'),
    withUploads((req, res) => {
      const me = requireUser(req);
      const row = requireTrack(idParam(req.params.id));
      if (row.user_id !== me) throw forbidden('Редактировать можно только свои треки');
      const input = parse(updateSchema, req.body ?? {});
      db.prepare(
        `UPDATE tracks SET title = COALESCE(@title, title), artist = COALESCE(@artist, artist),
           description = COALESCE(@description, description), genre = CASE WHEN @genreSet THEN @genre ELSE genre END,
           cover_path = COALESCE(@cover, cover_path)
         WHERE id = @id`,
      ).run({
        id: row.id,
        title: input.title ?? null,
        artist: nonEmpty(input.artist) ?? null,
        description: input.description ?? null,
        // A sent but empty genre clears it; an absent one leaves it unchanged.
        genreSet: input.genre === undefined ? 0 : 1,
        genre: normalizeGenre(input.genre),
        cover: req.file?.filename ?? null,
      });
      if (req.file) removeUpload(config, 'covers', row.cover_path);
      // Lyrics were looked up by the old names.
      if ((input.title && input.title !== row.title) || (nonEmpty(input.artist) && input.artist !== row.artist)) {
        db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(row.id);
      }
      res.json(getTrack(db, row.id, me));
    }),
  );

  r.delete('/:id', (req, res) => {
    const me = requireUser(req);
    const row = requireTrack(idParam(req.params.id));
    if (row.user_id !== me) throw forbidden('Удалять можно только свои треки');
    db.prepare('DELETE FROM tracks WHERE id = ?').run(row.id);
    removeUpload(config, 'audio', row.audio_path);
    removeUpload(config, 'covers', row.cover_path);
    res.json({ ok: true });
  });

  // ---------- likes & plays ----------

  const likeCount = (id: number) =>
    (db.prepare('SELECT COUNT(*) AS c FROM likes WHERE track_id = ?').get(id) as { c: number }).c;

  r.post('/:id/like', (req, res) => {
    const me = requireUser(req);
    const row = requireTrack(idParam(req.params.id));
    db.prepare('INSERT OR IGNORE INTO likes (user_id, track_id) VALUES (?, ?)').run(me, row.id);
    res.json({ liked: true, likeCount: likeCount(row.id) });
  });

  r.delete('/:id/like', (req, res) => {
    const me = requireUser(req);
    const row = requireTrack(idParam(req.params.id));
    db.prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?').run(me, row.id);
    res.json({ liked: false, likeCount: likeCount(row.id) });
  });

  r.post('/:id/play', (req, res) => {
    const row = requireTrack(idParam(req.params.id));
    const userId = req.userId ?? null;
    const recent =
      userId &&
      db
        .prepare(`SELECT 1 FROM plays WHERE user_id = ? AND track_id = ? AND created_at >= ?`)
        .get(userId, row.id, new Date(Date.now() - PLAY_DEDUPE_SECONDS * 1000).toISOString());
    if (!recent) {
      db.transaction(() => {
        db.prepare('INSERT INTO plays (track_id, user_id) VALUES (?, ?)').run(row.id, userId);
        db.prepare('UPDATE tracks SET play_count = play_count + 1 WHERE id = ?').run(row.id);
      })();
    }
    const { play_count } = db.prepare('SELECT play_count FROM tracks WHERE id = ?').get(row.id) as {
      play_count: number;
    };
    res.json({ playCount: play_count });
  });

  // ---------- comments ----------

  r.get('/:id/comments', (req, res) => {
    const row = requireTrack(idParam(req.params.id));
    const comments = db
      .prepare(
        `SELECT c.id, c.body, c.at_seconds, c.created_at, c.user_id, u.username, u.display_name, u.avatar_path
         FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.track_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 500`,
      )
      .all(row.id) as {
      id: number;
      body: string;
      at_seconds: number | null;
      created_at: string;
      user_id: number;
      username: string;
      display_name: string;
      avatar_path: string | null;
    }[];
    res.json(
      comments.map((c) => ({
        id: c.id,
        body: c.body,
        atSeconds: c.at_seconds,
        createdAt: c.created_at,
        canDelete: req.userId === c.user_id || req.userId === row.user_id,
        user: { id: c.user_id, username: c.username, displayName: c.display_name, avatarUrl: avatarUrl(c.avatar_path) },
      })),
    );
  });

  r.post('/:id/comments', (req, res) => {
    const me = requireUser(req);
    const row = requireTrack(idParam(req.params.id));
    const input = parse(commentSchema, req.body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO comments (track_id, user_id, body, at_seconds) VALUES (?, ?, ?, ?)')
      .run(row.id, me, input.body, input.atSeconds ?? null);
    const user = db.prepare('SELECT username, display_name, avatar_path FROM users WHERE id = ?').get(me) as {
      username: string;
      display_name: string;
      avatar_path: string | null;
    };
    res.status(201).json({
      id: Number(lastInsertRowid),
      body: input.body,
      atSeconds: input.atSeconds ?? null,
      createdAt: new Date().toISOString(),
      canDelete: true,
      user: { id: me, username: user.username, displayName: user.display_name, avatarUrl: avatarUrl(user.avatar_path) },
    });
  });

  r.delete('/:id/comments/:commentId', (req, res) => {
    const me = requireUser(req);
    const row = requireTrack(idParam(req.params.id));
    const comment = db
      .prepare('SELECT user_id FROM comments WHERE id = ? AND track_id = ?')
      .get(idParam(req.params.commentId), row.id) as { user_id: number } | undefined;
    if (!comment) throw notFound('Комментарий не найден');
    if (comment.user_id !== me && row.user_id !== me) throw forbidden();
    db.prepare('DELETE FROM comments WHERE id = ?').run(idParam(req.params.commentId));
    res.json({ ok: true });
  });

  // ---------- playback ----------

  const resolveExternal = async (row: TrackRow, userId: number | null, fresh = false): Promise<StreamSource> => {
    const provider = providers.get(row.source);
    const key = provider.requiresToken ? `${row.id}:${userId ?? 0}` : String(row.id);
    const cached = streamCache.get(key);
    if (!fresh && cached && cached.expires > Date.now()) return cached.source;

    let extra: Record<string, unknown> | null = null;
    try {
      extra = row.extra ? JSON.parse(row.extra) : null;
    } catch {
      extra = null;
    }
    const token = provider.requiresToken ? await sync.userToken(provider.id, userId) : null;
    const source = await provider.resolveStream(
      { externalId: row.external_id ?? '', streamUrl: row.stream_url, extra },
      { token },
    );
    if (!source) throw notFound(`Трек больше недоступен в сервисе ${provider.name}`);
    // Signed links can expire sooner than the cache would keep them (SoundCloud's last about as long as the track).
    const expires = Math.min(Date.now() + STREAM_CACHE_TTL_MS, (signedUrlExpiry(source.url) ?? Infinity) - 60_000);
    if (expires > Date.now()) streamCache.set(key, { source, expires });
    return source;
  };

  const streamToken = (trackId: number, userId: number) =>
    jwt.sign({ sub: String(userId), tid: trackId }, config.jwtSecret, { expiresIn: STREAM_TOKEN_TTL });

  /** `<audio>` requests carry no Authorization header, so the user comes from a signed query token. */
  const streamUser = (req: Request, trackId: number): number | null => {
    if (typeof req.query.t === 'string') {
      try {
        const payload = jwt.verify(req.query.t, config.jwtSecret) as jwt.JwtPayload;
        if (payload.tid === trackId) return Number(payload.sub) || null;
      } catch {
        // expired or forged token: fall through
      }
    }
    return req.userId ?? null;
  };

  /** Tells the player how to play a track: a plain URL or an HLS playlist. */
  r.get('/:id/source', async (req, res) => {
    const row = requireTrack(idParam(req.params.id));
    const local = `/api/tracks/${row.id}/stream`;
    if (row.source === 'local') return res.json({ kind: 'direct', url: local });

    const provider = providers.get(row.source);
    const source = await resolveExternal(row, req.userId ?? null);
    if (source.kind === 'hls' || !provider.proxyStreams) return res.json(source);
    const url = req.userId ? `${local}?t=${encodeURIComponent(streamToken(row.id, req.userId))}` : local;
    res.json({ kind: 'direct', url });
  });

  const relay = async (req: Request, res: Response, url: string, headers: Record<string, string>) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const upstream = await ctx.fetchImpl(url, {
      headers: { ...headers, ...(req.headers.range ? { range: req.headers.range } : {}) },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {});
      return upstream.status;
    }
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('cache-control', 'no-store');
    if (!upstream.body) {
      res.end();
      return upstream.status;
    }
    await pipeline(Readable.fromWeb(upstream.body as WebReadableStream), res).catch(() => {});
    return upstream.status;
  };

  /**
   * The same song on a service that plays plain audio. YouTube's terms allow its videos only in a visible player, so
   * when the listener closes it the app carries on with this version: a full track (no previews) whose title and
   * performer match and whose length is within 20 seconds.
   */
  r.get('/:id/audio-version', async (req, res) => {
    const me = requireUser(req);
    const row = requireTrack(idParam(req.params.id));
    const song = songQuery(row);
    const want = { title: normalizeText(song.title), artist: normalizeText(song.artist) };
    const services = providers
      .list()
      .filter((p) => p.id !== row.source && p.id !== 'youtube' && p.fullTracks && p.search && p.isConfigured());
    const found = await Promise.all(
      services.map(async (p) => {
        try {
          const hits = await p.search!(`${song.artist} ${song.title}`, { token: await sync.userToken(p.id, me) });
          return hits.tracks.map((t) => ({ provider: p.id, t }));
        } catch {
          return []; // a service that is down or not connected just has no version
        }
      }),
    );
    const [best] = found
      .flat()
      .filter(({ t }) => !t.isPreview)
      .map((c) => ({
        ...c,
        title: closeness(normalizeText(cleanTitle(c.t.title)), want.title),
        artist: closeness(normalizeText(c.t.artist), want.artist),
        off: row.duration && c.t.duration ? Math.abs(row.duration - c.t.duration) : 0,
      }))
      .filter((c) => c.title > 0 && c.artist > 0 && c.off <= 20)
      .sort((a, b) => b.title + b.artist - (a.title + a.artist) || a.off - b.off);
    if (!best) throw notFound('Этой песни нет в сервисах, где она играет без видео');
    const { ids } = sync.storeTracks([best.t], best.provider, null);
    res.json(getTrack(db, ids[0], me));
  });

  /**
   * The track's audio as one file, which the app keeps on the device for listening offline. YouTube's terms forbid
   * this, so its tracks are refused.
   */
  r.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
    const me = requireUser(req);
    const row = requireTrack(idParam(req.params.id));
    if (row.source === 'local') {
      if (!row.audio_path) throw notFound('Аудиофайл не найден');
      const type = AUDIO_TYPES[path.extname(row.audio_path)] ?? 'application/octet-stream';
      return res.sendFile(path.join(uploadDir(config, 'audio'), row.audio_path), { headers: { 'content-type': type } }, (err) => {
        if (err && !res.headersSent) next((err as NodeJS.ErrnoException).code === 'ENOENT' ? notFound('Аудиофайл не найден') : err);
      });
    }
    const provider = providers.get(row.source);
    const fetchFile = async (fresh: boolean) =>
      downloadAudio(await resolveExternal(row, me, fresh), provider.streamHeaders ?? {}, ctx.fetchImpl, provider.id);
    let file: AudioFile;
    try {
      file = await fetchFile(false);
    } catch (err) {
      // Signed service links expire; try once more with a fresh one.
      if (!(err instanceof ProviderError && [403, 404, 410].includes(Number(err.code)))) throw err;
      file = await fetchFile(true);
    }
    res.status(200);
    res.setHeader('content-type', file.type);
    res.setHeader('content-length', String(file.bytes.length));
    res.setHeader('cache-control', 'no-store');
    res.end(file.bytes);
  });

  r.get('/:id/stream', async (req: Request, res: Response, next: NextFunction) => {
    const row = requireTrack(idParam(req.params.id));

    if (row.source === 'local') {
      if (!row.audio_path) throw notFound('Аудиофайл не найден');
      const file = path.join(uploadDir(config, 'audio'), row.audio_path);
      const type =
        AUDIO_TYPES[path.extname(row.audio_path)] ??
        (row.audio_mime?.startsWith('audio/') ? row.audio_mime : 'application/octet-stream');
      return res.sendFile(file, { acceptRanges: true, maxAge: '1d', headers: { 'content-type': type } }, (err) => {
        if (err && !res.headersSent) next((err as NodeJS.ErrnoException).code === 'ENOENT' ? notFound('Аудиофайл не найден') : err);
      });
    }

    const provider = providers.get(row.source);
    const userId = streamUser(req, row.id);
    let source = await resolveExternal(row, userId);
    if (source.kind === 'hls' || !provider.proxyStreams) return res.redirect(302, source.url);

    let status = await relay(req, res, source.url, provider.streamHeaders ?? {});
    if ([403, 404, 410].includes(status) && !res.headersSent) {
      // Signed service URLs expire; fetch a fresh one once.
      source = await resolveExternal(row, userId, true);
      status = await relay(req, res, source.url, provider.streamHeaders ?? {});
    }
    if (!res.headersSent) throw new HttpError(502, `Сервис ${provider.name} не отдал аудио (HTTP ${status})`);
  });

  return r;
}
