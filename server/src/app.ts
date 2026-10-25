import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { AppContext } from './context.js';
import { HttpError } from './lib/errors.js';
import { ProviderError } from './lib/http.js';
import { ensureUploadDirs, uploadDir } from './lib/uploads.js';
import { authenticate } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { discoverRoutes } from './routes/discover.js';
import { geniusRoutes } from './routes/genius.js';
import { meRoutes } from './routes/me.js';
import { playlistRoutes } from './routes/playlists.js';
import { serviceRoutes } from './routes/services.js';
import { settingsRoutes } from './routes/settings.js';
import { spotifyRoutes } from './routes/spotify.js';
import { waveRoutes } from './routes/wave.js';
import { SongVersions } from './lib/versions.js';
import { trackRoutes } from './routes/tracks.js';
import { userRoutes } from './routes/users.js';

export function createApp(ctx: AppContext) {
  const { config } = ctx;
  ensureUploadDirs(config);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  // Covers and avatars are public; audio is only served through /api/tracks/:id/stream.
  app.use('/media/covers', express.static(uploadDir(config, 'covers'), { maxAge: '7d', fallthrough: false }));
  app.use('/media/avatars', express.static(uploadDir(config, 'avatars'), { maxAge: '7d', fallthrough: false }));

  const api = express.Router();
  // Song versions found on other services are shared by the player's lookups and «Моя волна».
  const versions = new SongVersions(ctx.db, ctx.providers, ctx.sync);
  api.use(authenticate(ctx));
  api.get('/health', (_req, res) => {
    // Readable from any origin so the Android app can check that an address really is a soundFy server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ ok: true, app: 'soundfy' });
  });
  api.use('/auth', authRoutes(ctx));
  api.use('/me', meRoutes(ctx));
  api.use('/users', userRoutes(ctx));
  api.use('/tracks', trackRoutes(ctx, versions));
  api.use('/playlists', playlistRoutes(ctx));
  api.use(geniusRoutes(ctx));
  api.use(discoverRoutes(ctx));
  api.use(serviceRoutes(ctx));
  api.use(settingsRoutes(ctx));
  api.use(spotifyRoutes(ctx));
  api.use(waveRoutes(ctx, versions));
  api.use((_req, res) => {
    res.status(404).json({ error: 'Метод API не найден' });
  });
  app.use('/api', api);

  // In production the server also hosts the built single-page app.
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/media/')) return next();
      res.sendFile(indexHtml);
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof ProviderError) {
      res.status(err.code === 'no_token' ? 403 : 502).json({ error: err.message, provider: err.provider });
    } else if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Файл слишком большой (максимум ${Math.round(config.maxUploadBytes / 1024 / 1024)} МБ)`
          : `Ошибка загрузки: ${err.message}`;
      res.status(400).json({ error: message });
    } else if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Некорректный JSON' });
    } else if ((err as { status?: number }).status === 404) {
      res.status(404).json({ error: 'Файл не найден' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
  });

  return app;
}
