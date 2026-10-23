import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notFound } from '../lib/errors.js';
import { getTrackRow } from '../lib/tracks.js';
import { idParam, parse } from '../lib/validate.js';
import type { SongVersions } from '../lib/versions.js';
import { requireUser } from '../middleware/auth.js';
import { WAVE_MODES, WaveService, type WaveMode } from '../wave/service.js';

/** Most queue ids a request may name to keep out of the next batch. */
const MAX_EXCLUDE = 300;

const dislikeSchema = z.object({ trackId: z.number().int().positive() });

export function waveRoutes(ctx: AppContext, versions: SongVersions) {
  const r = Router();
  const wave = new WaveService(ctx.db, ctx.providers, ctx.sync, versions);
  /** ?on=<service>: the one the listener listens through («Слушать через»), if it plays whole songs. */
  const preferred = (on: unknown) => (typeof on === 'string' && ctx.providers.find(on)?.fullTracks ? on : null);

  /**
   * The next songs of «Моя волна», whole songs only: ?mode=mix|favorite|discover|popular&exclude=<ids in the
   * queue>&limit=10&on=<service listened through>&background=1.
   */
  r.get('/wave', async (req, res) => {
    const me = requireUser(req);
    const mode: WaveMode = (WAVE_MODES as readonly string[]).includes(String(req.query.mode)) ? (req.query.mode as WaveMode) : 'mix';
    const exclude = String(req.query.exclude ?? '')
      .split(',')
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(-MAX_EXCLUDE);
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
    // ?background=1: the queue topping itself up, which nobody waits on yet.
    const background = req.query.background === '1';
    res.json({ mode, tracks: await wave.next(me, { mode, exclude, limit, preferred: preferred(req.query.on), background }) });
  });

  /** «Не нравится»: the song, and after a second one its artist, stay out of the wave. */
  r.post('/wave/dislikes', (req, res) => {
    const me = requireUser(req);
    const { trackId } = parse(dislikeSchema, req.body);
    if (!getTrackRow(ctx.db, trackId)) throw notFound('Трек не найден');
    wave.dislike(me, trackId);
    res.status(204).end();
  });

  r.delete('/wave/dislikes/:id', (req, res) => {
    wave.undoDislike(requireUser(req), idParam(req.params.id));
    res.status(204).end();
  });

  /** Songs for the feed's «Для вас», the same choice as the wave, kept for half an hour (?refresh=1 picks anew). */
  r.get('/recommendations', async (req, res) => {
    const me = requireUser(req);
    res.json({ tracks: await wave.recommend(me, preferred(req.query.on), req.query.refresh === '1') });
  });

  return r;
}
