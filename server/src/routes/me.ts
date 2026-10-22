import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { queryPlaylists } from '../lib/playlists.js';
import { parsePaging, queryTracks, type TrackDTO } from '../lib/tracks.js';
import { createUploader, removeUpload, withUploads } from '../lib/uploads.js';
import { parse } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';
import { toMe, type UserRow } from './auth.js';

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'не может быть пустым').max(60).optional(),
  bio: z.string().trim().max(1000).optional(),
});

/** Fetches tracks by id, keeping the order of `ids`. */
export function tracksByIds(ctx: AppContext, ids: number[], viewer?: number): Map<number, TrackDTO> {
  if (!ids.length) return new Map();
  const tracks = queryTracks(ctx.db, 'WHERE t.id IN (SELECT value FROM json_each(@ids))', { ids: JSON.stringify(ids) }, viewer);
  return new Map(tracks.map((t) => [t.id, t]));
}

export function meRoutes(ctx: AppContext) {
  const r = Router();
  const { db, config } = ctx;
  const upload = createUploader(config);

  r.patch(
    '/',
    upload.single('avatar'),
    withUploads((req, res) => {
      const me = requireUser(req);
      const input = parse(profileSchema, req.body ?? {});
      const current = db.prepare('SELECT * FROM users WHERE id = ?').get(me) as UserRow;
      db.prepare(
        `UPDATE users SET display_name = COALESCE(@displayName, display_name), bio = COALESCE(@bio, bio),
           avatar_path = COALESCE(@avatar, avatar_path) WHERE id = @id`,
      ).run({
        id: me,
        displayName: input.displayName ?? null,
        bio: input.bio ?? null,
        avatar: req.file?.filename ?? null,
      });
      if (req.file) removeUpload(config, 'avatars', current.avatar_path);
      res.json({ user: toMe(db.prepare('SELECT * FROM users WHERE id = ?').get(me) as UserRow) });
    }),
  );

  r.get('/playlists', (req, res) => {
    const me = requireUser(req);
    res.json(queryPlaylists(db, 'WHERE p.user_id = @me ORDER BY p.updated_at DESC', { me }));
  });

  /** Recently played tracks, most recent play of each track first. */
  r.get('/history', (req, res) => {
    const me = requireUser(req);
    const { limit, offset } = parsePaging(req.query);
    res.json(
      queryTracks(
        db,
        `JOIN (SELECT track_id, MAX(id) AS last_play FROM plays WHERE user_id = @me GROUP BY track_id) h ON h.track_id = t.id
         ORDER BY h.last_play DESC LIMIT @limit OFFSET @offset`,
        { me, limit, offset },
        me,
      ),
    );
  });

  r.get('/notifications', (req, res) => {
    const me = requireUser(req);
    const { limit, offset } = parsePaging(req.query, 30);
    const rows = db
      .prepare(
        `SELECT id, track_id, type, is_read, created_at FROM notifications
         WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(me, limit, offset) as { id: number; track_id: number; type: string; is_read: number; created_at: string }[];
    const tracks = tracksByIds(
      ctx,
      rows.map((n) => n.track_id),
      me,
    );
    res.json(
      rows
        .filter((n) => tracks.has(n.track_id))
        .map((n) => ({
          id: n.id,
          type: n.type,
          isRead: Boolean(n.is_read),
          createdAt: n.created_at,
          track: tracks.get(n.track_id),
        })),
    );
  });

  r.get('/notifications/unread-count', (req, res) => {
    const me = requireUser(req);
    const { count } = db
      .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(me) as { count: number };
    res.json({ count });
  });

  r.post('/notifications/read', (req, res) => {
    const me = requireUser(req);
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(me);
    res.json({ ok: true });
  });

  return r;
}
