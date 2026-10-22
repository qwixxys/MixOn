import type { AppConfig } from './config.js';
import type { DB } from './db/index.js';
import type { FetchLike } from './lib/http.js';
import type { ProviderRegistry } from './providers/index.js';
import type { SyncService } from './sync/syncService.js';

export interface AppContext {
  db: DB;
  config: AppConfig;
  providers: ProviderRegistry;
  sync: SyncService;
  /** Used to relay external audio streams. */
  fetchImpl: FetchLike;
}
