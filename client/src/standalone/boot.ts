// Runs the MixOn server inside the page, for the Android app that works without a computer. The server's own code
// is bundled here with small stand-ins for what only exists in Node (see vite.config.ts): SQLite runs as WebAssembly
// and is saved to the device, services are called through the native HTTP client, and the page's requests to /api
// are answered in-process instead of going over the network.
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { createApp } from '../../../server/src/app';
import type { AppConfig } from '../../../server/src/config';
import type { AppContext } from '../../../server/src/context';
import { dbStore, prepareDatabase, type DB } from '../../../server/src/db/index';
import { GeniusClient } from '../../../server/src/genius/client';
import { GeniusService } from '../../../server/src/genius/service';
import { LrclibClient } from '../../../server/src/lyrics/lrclib';
import { LyricsService } from '../../../server/src/lyrics/service';
import { createProviders } from '../../../server/src/providers/index';
import { VK_USER_AGENT } from '../../../server/src/providers/vk';
import { ServiceSettings } from '../../../server/src/settings';
import { SyncService } from '../../../server/src/sync/syncService';
import { version } from '../../package.json';
import { getToken, setToken } from '../api/client';
import { setSaveNow } from '../lib/standalone';
import { createNativeFetch } from './nativeFetch';
import Database, { initSqlite } from './shims/better-sqlite3';
import type { App } from './shims/express';
import { loadDatabase, saveDatabase } from './storage';

/** The one account on the device; its random password never leaves the database. */
const ACCOUNT = { username: 'listener', email: 'listener@soundfy.local', displayName: 'Я' };
const PASSWORD_KEY = 'standalone.password';
// At most one save per this interval while changes keep coming (a sync stores many tracks one by one).
const SAVE_DELAY_MS = 1500;

function standaloneConfig(): AppConfig {
  return {
    port: 0,
    host: undefined,
    dataDir: '/soundfy',
    // Tokens never leave the device, so they are not signed (see shims/jsonwebtoken.ts).
    jwtSecret: 'standalone',
    syncIntervalMinutes: 60,
    maxUploadBytes: 0,
    clientDist: '/soundfy/client',
    publicUrl: null,
    itunes: { country: 'US' },
    jamendo: { clientId: null },
    // The phone asks VK for audio links and plays them itself, so nothing needs relaying (see VkAudioRelay.java).
    vk: { accessToken: null, apiVersion: '5.131', userAgent: VK_USER_AGENT, relayStreams: false },
    soundcloud: { clientId: null, clientSecret: null, publicClient: false },
    genius: { accessToken: null },
    youtube: { apiKey: null },
    lrclib: { baseUrl: 'https://lrclib.net', userAgent: `MixOn v${version} (https://github.com/qwixxys/soundFy)` },
  };
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function abortable(promise: Promise<Response>, signal: AbortSignal | null | undefined): Promise<Response> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  ]);
}

/**
 * Saves the database a moment after it changes, and at once when the app goes to the background. Returns a function
 * that saves pending changes now.
 */
function persist(db: Database) {
  let timer: number | undefined;
  let chain = Promise.resolve();
  const save = () => {
    window.clearTimeout(timer);
    timer = undefined;
    chain = chain
      .then(() => saveDatabase(db.serialize()))
      .catch((err) => console.error('MixOn: не удалось сохранить данные', err));
    return chain;
  };
  db.onChange = () => {
    timer ??= window.setTimeout(save, SAVE_DELAY_MS);
  };
  const flush = () => (timer !== undefined ? save() : chain);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush());
  window.addEventListener('pagehide', () => void flush());
  return { save, flush };
}

async function signIn(app: App, db: DB) {
  const call = async (path: string, body?: unknown, token?: string | null) => {
    const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await app.fetch(
      new Request(new URL(`/api${path}`, location.href), { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined }),
    );
    return { ok: res.ok, data: (await res.json().catch(() => null)) as { token?: string; error?: string } | null };
  };

  if ((await call('/auth/me', undefined, getToken())).ok) return;
  const store = dbStore(db);
  let password = store.get(PASSWORD_KEY);
  const result = password
    ? await call('/auth/login', { login: ACCOUNT.username, password })
    : await call('/auth/register', { ...ACCOUNT, password: (password = randomPassword()) });
  if (!result.ok || !result.data?.token) throw new Error(result.data?.error ?? 'Не удалось открыть профиль');
  store.set(PASSWORD_KEY, password);
  setToken(result.data.token);
}

export async function boot(): Promise<void> {
  const pageFetch = window.fetch.bind(window);
  const fetchImpl = createNativeFetch(pageFetch);

  await initSqlite({ locateFile: () => wasmUrl });
  const saved = await loadDatabase().catch((err) => {
    console.error('MixOn: не удалось прочитать сохранённые данные', err);
    return null;
  });
  const raw = new Database(saved ?? undefined);
  const { save, flush } = persist(raw);
  setSaveNow(flush);
  const db = prepareDatabase(raw as unknown as DB, { wal: false });
  void navigator.storage?.persist?.().catch(() => false);

  const config = standaloneConfig();
  const store = dbStore(db);
  // Keys entered in the app (the service cards on «Сервисы») are kept in the database like on a server.
  const settings = new ServiceSettings(store, config, {});
  const providers = createProviders(config, store, fetchImpl);
  const sync = new SyncService(db, providers);
  const genius = new GeniusService(db, new GeniusClient(config.genius.accessToken, fetchImpl));
  const lyrics = new LyricsService(db, new LrclibClient(config.lrclib.baseUrl, config.lrclib.userAgent, fetchImpl));
  settings.bind({ providers, genius, fetchImpl });
  const ctx: AppContext = { db, config, providers, sync, genius, lyrics, settings, fetchImpl };
  const app = createApp(ctx) as unknown as App;

  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !/^\/(api|media)\//.test(url.pathname)) return pageFetch(input, init);
    const request = new Request(input, init);
    return abortable(app.fetch(request), request.signal);
  };

  await signIn(app, db);
  if (!saved) await save();
  sync.start(config.syncIntervalMinutes);
}
