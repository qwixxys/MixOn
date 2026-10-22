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

  r.get('/genius/search', async (req, res) => {
    requireUser(req);
    if (!genius.isConfigured()) throw badRequest('Genius не настроен на сервере');
    const q = String(req.query.q ?? '').trim();
    res.json(q ? await genius.search(q.slice(0, 200)) : []);
  });

  return r;
}
