import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { forbidden, notFound } from '../lib/errors.js';
import { queryPlaylists } from '../lib/playlists.js';
import { getTrackRow, queryTracks } from '../lib/tracks.js';
import { idParam, parse } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';

const createSchema = z.object({
  title: z.string().trim().min(1, 'укажите название').max(100),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean().optional(),
  trackIds: z.array(z.number().int().positive()).max(500).optional(),
});
const updateSchema = z.object({
  title: z.string().trim().min(1, 'укажите название').max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean().optional(),
});
const addTrackSchema = z.object({ trackId: z.number().int().positive() });

const TOUCH = `UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`;

export function playlistRoutes(ctx: AppContext) {
  const r = Router();
  const { db } = ctx;

  const load = (id: number, viewer: number | undefined) => {
    const [playlist] = queryPlaylists(db, 'WHERE p.id = @id', { id });
    if (!playlist || (!playlist.isPublic && playlist.owner.id !== viewer)) throw notFound('Плейлист не найден');
    return playlist;
  };
  const loadOwn = (id: number, me: number) => {
    const playlist = load(id, me);
    if (playlist.owner.id !== me) throw forbidden('Это не ваш плейлист');
    return playlist;
  };
  const addTracks = (playlistId: number, trackIds: number[]) => {
    const { pos } = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS pos FROM playlist_tracks WHERE playlist_id = ?')
      .get(playlistId) as { pos: number };
    const insert = db.prepare(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
    );
    let next = pos + 1;
    for (const trackId of trackIds) {
      if (!getTrackRow(db, trackId)) throw notFound(`Трек ${trackId} не найден`);
      if (insert.run(playlistId, trackId, next).changes) next++;
    }
    db.prepare(TOUCH).run(playlistId);
  };

  r.post('/', (req, res) => {
    const me = requireUser(req);
    const input = parse(createSchema, req.body);
    const id = db.transaction(() => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO playlists (user_id, title, description, is_public) VALUES (?, ?, ?, ?)')
        .run(me, input.title, input.description ?? '', input.isPublic === false ? 0 : 1);
      const playlistId = Number(lastInsertRowid);
      if (input.trackIds?.length) addTracks(playlistId, input.trackIds);
      return playlistId;
    })();
    res.status(201).json(load(id, me));
  });

  r.get('/:id', (req, res) => {
    const playlist = load(idParam(req.params.id), req.userId);
    const tracks = queryTracks(
      db,
      'JOIN playlist_tracks pt ON pt.track_id = t.id AND pt.playlist_id = @id ORDER BY pt.position',
      { id: playlist.id },
      req.userId,
    );
    res.json({ ...playlist, tracks });
  });

  r.patch('/:id', (req, res) => {
    const me = requireUser(req);
    const playlist = loadOwn(idParam(req.params.id), me);
    const input = parse(updateSchema, req.body);
    db.prepare(
      `UPDATE playlists SET title = COALESCE(@title, title), description = COALESCE(@description, description),
         is_public = COALESCE(@isPublic, is_public), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = @id`,
    ).run({
      id: playlist.id,
      title: input.title ?? null,
      description: input.description ?? null,
      isPublic: input.isPublic === undefined ? null : input.isPublic ? 1 : 0,
    });
    res.json(load(playlist.id, me));
  });

  r.delete('/:id', (req, res) => {
    const me = requireUser(req);
    const playlist = loadOwn(idParam(req.params.id), me);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(playlist.id);
    res.json({ ok: true });
  });

  r.post('/:id/tracks', (req, res) => {
    const me = requireUser(req);
    const playlist = loadOwn(idParam(req.params.id), me);
    const { trackId } = parse(addTrackSchema, req.body);
    db.transaction(() => addTracks(playlist.id, [trackId]))();
    res.json(load(playlist.id, me));
  });

  r.delete('/:id/tracks/:trackId', (req, res) => {
    const me = requireUser(req);
    const playlist = loadOwn(idParam(req.params.id), me);
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(
      playlist.id,
      idParam(req.params.trackId),
    );
    db.prepare(TOUCH).run(playlist.id);
    res.json(load(playlist.id, me));
  });

  return r;
}
