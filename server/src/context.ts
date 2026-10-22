import type { AppConfig } from './config.js';
import type { DB } from './db/index.js';
import type { GeniusService } from './genius/service.js';
import type { LyricsService } from './lyrics/service.js';
import type { FetchLike } from './lib/http.js';
import type { ProviderRegistry } from './providers/index.js';
import type { ServiceSettings } from './settings.js';
import type { SyncService } from './sync/syncService.js';

export interface AppContext {
  db: DB;
  config: AppConfig;
  providers: ProviderRegistry;
  sync: SyncService;
  genius: GeniusService;
  lyrics: LyricsService;
  settings: ServiceSettings;
  /** Used to relay external audio streams. */
  fetchImpl: FetchLike;
}
