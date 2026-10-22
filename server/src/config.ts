import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  dataDir: string;
  jwtSecret: string;
  syncIntervalMinutes: number;
  maxUploadBytes: number;
  clientDist: string;
  /** Public origin used in OAuth redirect URIs; derived from the request when unset. */
  publicUrl: string | null;
  itunes: { country: string };
  jamendo: { clientId: string | null };
  vk: { accessToken: string | null; apiVersion: string; userAgent: string };
  soundcloud: { clientId: string | null; clientSecret: string | null };
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

export function loadConfig(): AppConfig {
  const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');
  return {
    port: num(process.env.PORT, 4000),
    dataDir,
    jwtSecret: resolveJwtSecret(dataDir),
    syncIntervalMinutes: num(process.env.SYNC_INTERVAL_MINUTES, 60),
    maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 100) * 1024 * 1024,
    clientDist: path.join(rootDir, 'client', 'dist'),
    publicUrl: process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : null,
    itunes: { country: process.env.ITUNES_COUNTRY || 'US' },
    jamendo: { clientId: process.env.JAMENDO_CLIENT_ID || null },
    vk: {
      accessToken: process.env.VK_ACCESS_TOKEN || null,
      apiVersion: process.env.VK_API_VERSION || '5.131',
      userAgent:
        process.env.VK_USER_AGENT ||
        'KateMobileAndroid/56 lite-460 (Android 4.4.2; SDK 19; x86; unknown Android SDK built for x86; en)',
    },
    soundcloud: {
      clientId: process.env.SOUNDCLOUD_CLIENT_ID || null,
      clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET || null,
    },
  };
}
