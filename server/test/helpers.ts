import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDatabase } from '../src/db/index.js';
import { GeniusClient } from '../src/genius/client.js';
import { GeniusService } from '../src/genius/service.js';
import { LrclibClient } from '../src/lyrics/lrclib.js';
import { LyricsService } from '../src/lyrics/service.js';
import type { FetchLike } from '../src/lib/http.js';
import {
  ProviderRegistry,
  type ExternalTrack,
  type MusicProvider,
  type ProviderContext,
  type StoredExternalTrack,
  type StreamSource,
} from '../src/providers/index.js';
import { SyncService } from '../src/sync/syncService.js';

type Responder = (url: string, init?: RequestInit) => unknown;
type Route = [match: string | RegExp, body: unknown | Responder, status?: number];

/** A fetch stand-in that answers JSON fixtures by URL and records every request. */
export function fakeFetch(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const route = routes.find(([m]) => (typeof m === 'string' ? url.includes(m) : m.test(url)));
    if (!route) return new Response('not found', { status: 404 });
    const [, spec, status = 200] = route;
    const body = typeof spec === 'function' ? (spec as Responder)(url, init) : spec;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { impl, calls };
}

export function track(id: string, overrides: Partial<ExternalTrack> = {}): ExternalTrack {
  return {
    externalId: id,
    title: `Track ${id}`,
    artist: 'Test Artist',
    album: null,
    duration: 180,
    streamUrl: `https://cdn.example/${id}.mp3`,
    coverUrl: null,
    externalUrl: null,
    releasedAt: new Date().toISOString(),
    genre: null,
    isPreview: false,
    ...overrides,
  };
}

/** Provider whose catalogue tests can change between syncs. */
export class FakeProvider implements MusicProvider {
  readonly id = 'deezer' as const;
  readonly name = 'Fake';
  readonly description = 'fake';
  readonly requiresToken: boolean = false;
  readonly connectMode: 'token' | 'oauth' | null = null;
  readonly fullTracks: boolean = true;
  readonly proxyStreams: boolean = false;
  tracks: ExternalTrack[] = [];
  fail: string | null = null;
  isConfigured() {
    return true;
  }
  async searchArtists(q: string) {
    return [{ externalId: 'a1', name: q, imageUrl: null, url: null }];
  }
  async getArtistTracks() {
    if (this.fail) throw new Error(this.fail);
    return this.tracks;
  }
  async resolveStream(t: StoredExternalTrack, _ctx?: ProviderContext): Promise<StreamSource | null> {
    return t.streamUrl ? { url: t.streamUrl, kind: 'direct' as const } : null;
  }
}

export function testConfig(): AppConfig {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundfy-test-'));
  return {
    port: 0,
    host: undefined,
    dataDir,
    jwtSecret: 'test-secret',
    syncIntervalMinutes: 0,
    maxUploadBytes: 5 * 1024 * 1024,
    clientDist: path.join(dataDir, 'no-client'),
    publicUrl: null,
    itunes: { country: 'US' },
    jamendo: { clientId: null },
    vk: { accessToken: null, apiVersion: '5.131', userAgent: 'test' },
    soundcloud: { clientId: null, clientSecret: null, publicClient: false },
    genius: { accessToken: null },
    lrclib: { baseUrl: null, userAgent: 'soundFy-test' },
  };
}

export function createTestApp(
  providers: MusicProvider[] = [new FakeProvider()],
  fetchImpl: FetchLike = fetch,
  geniusToken: string | null = null,
  lrclibUrl: string | null = null,
) {
  const config = testConfig();
  const db = openDatabase(':memory:');
  const registry = new ProviderRegistry(providers);
  const sync = new SyncService(db, registry, { info() {}, warn() {}, error() {} });
  const genius = new GeniusService(db, new GeniusClient(geniusToken, fetchImpl));
  const lyrics = new LyricsService(db, new LrclibClient(lrclibUrl, 'soundFy-test', fetchImpl, 0));
  const ctx: AppContext = { db, config, providers: registry, sync, genius, lyrics, fetchImpl };
  const app = createApp(ctx);
  return { ctx, app, request: supertest(app), cleanup: () => fs.rmSync(config.dataDir, { recursive: true, force: true }) };
}

export async function register(request: supertest.Agent | ReturnType<typeof supertest>, username: string) {
  const res = await request
    .post('/api/auth/register')
    .send({ username, email: `${username}@example.com`, password: 'secret123' })
    .expect(201);
  return { token: res.body.token as string, user: res.body.user, auth: { Authorization: `Bearer ${res.body.token}` } };
}

/** One second of a 440 Hz sine wave as a 16-bit mono WAV. */
export function sineWav(seconds = 1, sampleRate = 8000): Buffer {
  const samples = seconds * sampleRate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), 44 + i * 2);
  }
  return buf;
}
