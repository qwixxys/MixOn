import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { getTrackRow, type TrackRow } from '../lib/tracks.js';
import { idParam, parse } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';

const linkSchema = z.object({ geniusId: z.number().int().positive().nullable() });

export function geniusRoutes(ctx: AppContext) {
  const r = Router();
  const { db, genius } = ctx;

  const requireTrack = (id: number) => {
    const row = getTrackRow(db, id);
    if (!row) throw notFound('Трек не найден');
    return row;
  };
  // Uploads are fixed by their author; tracks from services by any listener.
  const canEdit = (req: Request, row: TrackRow) => Boolean(req.userId && (row.source !== 'local' || row.user_id === req.userId));

  /** Song info from Genius for a track, matched automatically on first request. */
  r.get('/tracks/:id/genius', async (req, res) => {
    const row = requireTrack(idParam(req.params.id));
    res.json({ ...(await genius.forTrack(row)), canEdit: canEdit(req, row) });
  });

  r.put('/tracks/:id/genius', async (req, res) => {
    requireUser(req);
    const row = requireTrack(idParam(req.params.id));
    if (!canEdit(req, row)) throw forbidden('Привязывать песню к загруженному треку может только его автор');
    if (!genius.isConfigured()) throw badRequest('Genius не настроен на сервере');
    const { geniusId } = parse(linkSchema, req.body);
    res.json({ ...(await genius.link(row, geniusId)), canEdit: true });
  });

  /** Time-synced (or plain) lyrics from LRCLIB. */
  r.get('/tracks/:id/lyrics', async (req, res) => {
    res.json(await ctx.lyrics.forTrack(requireTrack(idParam(req.params.id))));
  });

  /** Artist info from Genius for an artist page (bio, photo, links, popular songs), matched by name on first request. */
  r.get('/artists/:id/genius', async (req, res) => {
    const artist = db
      .prepare('SELECT id, name, genius_id, genius_checked_at FROM external_artists WHERE id = ?')
      .get(idParam(req.params.id)) as { id: number; name: string; genius_id: number | null; genius_checked_at: string | null } | undefined;
    if (!artist) throw notFound('Артист не найден');
    res.json(await genius.forArtist(artist));
  });

  r.get('/genius/search', async (req, res) => {
    requireUser(req);
    if (!genius.isConfigured()) throw badRequest('Genius не настроен на сервере');
    const q = String(req.query.q ?? '').trim();
    res.json(q ? await genius.search(q.slice(0, 200)) : []);
  });

  return r;
}
