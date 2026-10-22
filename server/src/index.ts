import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { dbStore, openDatabase } from './db/index.js';
import { GeniusClient } from './genius/client.js';
import { GeniusService } from './genius/service.js';
import { createProviders } from './providers/index.js';
import { SyncService } from './sync/syncService.js';

const config = loadConfig();
const db = openDatabase(path.join(config.dataDir, 'soundfy.db'));
const providers = createProviders(config, dbStore(db));
const sync = new SyncService(db, providers);
const genius = new GeniusService(db, new GeniusClient(config.genius.accessToken));
const app = createApp({ db, config, providers, sync, genius, fetchImpl: fetch });

const server = app.listen(config.port, () => {
  console.info(`soundFy server: http://localhost:${config.port}`);
  console.info(`Данные: ${config.dataDir}`);
  if (config.syncIntervalMinutes > 0) {
    console.info(`Синхронизация артистов каждые ${config.syncIntervalMinutes} мин.`);
  }
});
sync.start(config.syncIntervalMinutes);

function shutdown() {
  sync.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
