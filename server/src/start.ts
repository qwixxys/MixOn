import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig, type AppConfig } from './config.js';
import { dbStore, openDatabase } from './db/index.js';
import { GeniusClient } from './genius/client.js';
import { GeniusService } from './genius/service.js';
import { LrclibClient } from './lyrics/lrclib.js';
import { LyricsService } from './lyrics/service.js';
import { createProviders } from './providers/index.js';
import { SyncService } from './sync/syncService.js';

export interface RunningServer {
  config: AppConfig;
  server: Server;
  /** The port actually listened on (differs from the configured one when that was 0). */
  port: number;
  close(): Promise<void>;
}

/**
 * Opens the database and starts the HTTP server with settings from the environment (see .env.example).
 * Used by the command-line entry point and by the desktop app, which runs the server inside Electron.
 */
export async function startServer(): Promise<RunningServer> {
  const config = loadConfig();
  const db = openDatabase(path.join(config.dataDir, 'soundfy.db'));
  const providers = createProviders(config, dbStore(db));
  const sync = new SyncService(db, providers);
  const genius = new GeniusService(db, new GeniusClient(config.genius.accessToken));
  const lyrics = new LyricsService(db, new LrclibClient(config.lrclib.baseUrl, config.lrclib.userAgent));
  const app = createApp({ db, config, providers, sync, genius, lyrics, fetchImpl: fetch });

  let server: Server;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const s = config.host ? app.listen(config.port, config.host, () => resolve(s)) : app.listen(config.port, () => resolve(s));
      s.once('error', reject);
    });
  } catch (err) {
    db.close();
    throw err;
  }
  sync.start(config.syncIntervalMinutes);

  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= new Promise<void>((resolve) => {
      sync.stop();
      server.close(() => {
        db.close();
        resolve();
      });
      server.closeAllConnections();
    }));

  return { config, server, port: (server.address() as AddressInfo).port, close };
}
