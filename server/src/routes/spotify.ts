import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { importSongs } from '../lib/spotify.js';
import { SpotifyAccounts } from '../lib/spotifyAccount.js';
import { parse } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';

const loginSchema = z.object({ clientId: z.string().trim(), redirectUri: z.string() });
const callbackSchema = z.object({ state: z.string(), code: z.string().nullish(), error: z.string().nullish() });
const importSchema = z.object({ list: z.string() });

/** A listener's Spotify account (lib/spotifyAccount.ts): sign in, then import liked songs and playlists. */
export function spotifyRoutes(ctx: AppContext) {
  const accounts = new SpotifyAccounts(ctx.db, ctx.fetchImpl);
  const r = Router();

  r.get('/spotify', (req, res) => {
    res.json(accounts.status(requireUser(req)));
  });

  r.post('/spotify/login', (req, res) => {
    const me = requireUser(req);
    const { clientId, redirectUri } = parse(loginSchema, req.body);
    res.json({ url: accounts.start(me, clientId, redirectUri) });
  });

  /** Spotify sends a browser, or the desktop app's sign-in window, back here. */
  r.get('/spotify/callback', async (req, res) => {
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    let params: Record<string, string>;
    try {
      await accounts.finish(text(req.query.state) ?? '', text(req.query.code), text(req.query.error));
      params = { connected: 'spotify' };
    } catch (err) {
      params = { error: (err as Error).message };
    }
    res.redirect(302, `/sync?${new URLSearchParams(params)}`);
  });

  /** The phone app hands over what Spotify sent it back with (MainActivity). */
  r.post('/spotify/callback', async (req, res) => {
    requireUser(req);
    const { state, code, error } = parse(callbackSchema, req.body);
    const { userId } = await accounts.finish(state, code ?? null, error ?? null);
    res.json(accounts.status(userId));
  });

  r.delete('/spotify', (req, res) => {
    const me = requireUser(req);
    accounts.disconnect(me);
    res.json(accounts.status(me));
  });

  r.get('/spotify/library', async (req, res) => {
    res.json(await accounts.library(requireUser(req)));
  });

  /** Liked songs (`list: 'liked'`) or one playlist into a private playlist, found on the listener's services. */
  r.post('/spotify/import', async (req, res) => {
    const me = requireUser(req);
    const { list } = parse(importSchema, req.body);
    const songs = await accounts.songs(me, list);
    res.status(201).json(await importSongs(ctx, me, songs, songs.url));
  });

  return r;
}
