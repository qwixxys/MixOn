import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VK_USER_AGENT } from './providers/vk.js';

// server/src/config.ts and server/dist/config.js are both two levels below the repo root.
export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  process.loadEnvFile(path.join(rootDir, '.env'));
} catch {
  // .env is optional
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

export interface AppConfig {
  port: number;
  /** Interface to listen on; unset means all of them. The desktop app uses 127.0.0.1 unless LAN access is on. */
  host: string | undefined;
  dataDir: string;
  jwtSecret: string;
  syncIntervalMinutes: number;
  maxUploadBytes: number;
  clientDist: string;
  /** Public origin used in OAuth redirect URIs; derived from the request when unset. */
  publicUrl: string | null;
  itunes: { country: string };
  /** `relayStreams` passes VK audio through this server (see VkOptions). */
  vk: { accessToken: string | null; apiVersion: string; userAgent: string; relayStreams: boolean };
  /** `publicClient` allows the unofficial keyless mode when no official keys are set; on unless turned off. */
  soundcloud: { clientId: string | null; clientSecret: string | null; publicClient: boolean };
  genius: { accessToken: string | null };
  /** YouTube Data API v3 key (Google Cloud), for YouTube Music. */
  youtube: { apiKey: string | null };
  /** LRCLIB base URL for synced lyrics, or null when turned off. */
  lrclib: { baseUrl: string | null; userAgent: string };
}

function resolveJwtSecret(dataDir: string): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, '.jwt-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

/** LRCLIB is on by default; "off" disables it, any other value points to a self-hosted mirror. */
function lrclibUrl(value: string | undefined): string | null {
  if (value === undefined || value === '') return 'https://lrclib.net';
  if (['off', 'false', '0', 'no'].includes(value.toLowerCase())) return null;
  return value.replace(/\/+$/, '');
}

export function loadConfig(): AppConfig {
  const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');
  return {
    port: num(process.env.PORT, 4000),
    host: process.env.HOST || undefined,
    dataDir,
    jwtSecret: resolveJwtSecret(dataDir),
    syncIntervalMinutes: num(process.env.SYNC_INTERVAL_MINUTES, 60),
    maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 100) * 1024 * 1024,
    clientDist: path.join(rootDir, 'client', 'dist'),
    publicUrl: process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : null,
    itunes: { country: process.env.ITUNES_COUNTRY || 'US' },
    vk: {
      accessToken: process.env.VK_ACCESS_TOKEN || null,
      apiVersion: process.env.VK_API_VERSION || '5.131',
      userAgent: process.env.VK_USER_AGENT || VK_USER_AGENT,
      relayStreams: true,
    },
    soundcloud: {
      clientId: process.env.SOUNDCLOUD_CLIENT_ID || null,
      clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET || null,
      publicClient: !['0', 'false', 'no', 'off'].includes((process.env.SOUNDCLOUD_PUBLIC_CLIENT ?? '').toLowerCase()),
    },
    genius: { accessToken: process.env.GENIUS_ACCESS_TOKEN || null },
    youtube: { apiKey: process.env.YOUTUBE_API_KEY || null },
    lrclib: {
      baseUrl: lrclibUrl(process.env.LRCLIB_URL),
      userAgent: 'MixOn v0.6.8 (https://github.com/qwixxys/MixOn)',
    },
  };
}
