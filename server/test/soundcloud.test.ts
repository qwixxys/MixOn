import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { openDatabase, dbStore } from '../src/db/index.js';
import { ProviderError } from '../src/lib/http.js';
import { parseScDate, scArtwork, SoundCloudProvider, type ScTrack } from '../src/providers/soundcloud.js';
import { createTestApp, fakeFetch, register } from './helpers.js';

const scTrack = (id: number, overrides: Partial<ScTrack> = {}): ScTrack => ({
  id,
  urn: `soundcloud:tracks:${id}`,
  title: `Трек ${id}`,
  user: { id: 7, urn: 'soundcloud:users:7', username: 'producer', avatar_url: 'https://i1.sndcdn.com/avatars-x-large.jpg' },
  duration: 185_000,
  artwork_url: `https://i1.sndcdn.com/artworks-${id}-large.jpg`,
  permalink_url: `https://soundcloud.com/producer/track-${id}`,
  created_at: `2026/10/0${id} 10:00:00 +0000`,
  genre: 'Lo-Fi',
  streamable: true,
  access: 'playable',
  ...overrides,
});

const tokenResponse = (token: string) => ({ access_token: token, refresh_token: `${token}-refresh`, expires_in: 3600 });
const auth = (init?: RequestInit) => (init?.headers as Record<string, string>)?.authorization;
const form = (init?: RequestInit) => new URLSearchParams(String(init?.body));

describe('SoundCloud provider', () => {
  const options = { clientId: 'cid', clientSecret: 'secret' };

  it('parses v1 dates and upsizes artwork', () => {
    assert.equal(parseScDate('2026/10/01 10:30:00 +0300'), '2026-10-01T07:30:00.000Z');
    assert.equal(parseScDate('2026-10-01T10:30:00Z'), '2026-10-01T10:30:00.000Z');
    assert.equal(parseScDate(null), null);
    assert.equal(scArtwork('https://i1.sndcdn.com/artworks-abc-large.jpg'), 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg');
  });

  it('is unavailable without credentials', async () => {
    const provider = new SoundCloudProvider({ clientId: null, clientSecret: null }, fakeFetch([]).impl);
    assert.equal(provider.isConfigured(), false);
    await assert.rejects(provider.searchArtists('x'), /SOUNDCLOUD_CLIENT_ID/);
  });

  it('gets one app token, caches and persists it', async () => {
    const store = dbStore(openDatabase(':memory:'));
    const { impl, calls } = fakeFetch([
      ['/oauth/token', tokenResponse('app-1')],
      [
        '/users?',
        {
          collection: [
            { id: 7, urn: 'soundcloud:users:7', username: 'producer', avatar_url: 'https://i1.sndcdn.com/avatars-x-large.jpg', permalink_url: 'https://soundcloud.com/producer', followers_count: 12_500, track_count: 40 },
          ],
        },
      ],
    ]);
    const provider = new SoundCloudProvider({ ...options, store }, impl);
    const [artist] = await provider.searchArtists('producer');
    await provider.searchArtists('again');

    const tokenCalls = calls.filter((c) => c.url.includes('/oauth/token'));
    assert.equal(tokenCalls.length, 1);
    assert.equal(auth(tokenCalls[0].init), `Basic ${Buffer.from('cid:secret').toString('base64')}`);
    assert.equal(form(tokenCalls[0].init).get('grant_type'), 'client_credentials');
    assert.equal(auth(calls[1].init), 'OAuth app-1');
    assert.deepEqual(artist, {
      externalId: 'soundcloud:users:7',
      name: 'producer',
      imageUrl: 'https://i1.sndcdn.com/avatars-x-t500x500.jpg',
      url: 'https://soundcloud.com/producer',
      subtitle: '12.5K подписчиков · 40 треков',
    });

    // A new process reuses the stored token instead of requesting another one.
    const second = fakeFetch([['/users?', { collection: [] }]]);
    await new SoundCloudProvider({ ...options, store }, second.impl).searchArtists('x');
    assert.equal(second.calls.filter((c) => c.url.includes('/oauth/token')).length, 0);
  });

  it('requests a new app token once when the cached one is rejected', async () => {
    let tokens = 0;
    const { impl } = fakeFetch([
      ['/oauth/token', () => tokenResponse(`app-${++tokens}`)],
      ['/users?', (_url: string, init?: RequestInit) => (auth(init) === 'OAuth app-1' ? new Response('{}', { status: 401 }) : { collection: [] })],
    ]);
    assert.deepEqual(await new SoundCloudProvider(options, impl).searchArtists('x'), []);
    assert.equal(tokens, 2);
  });

  it('maps an artist’s uploads newest first and skips blocked ones', async () => {
    const { impl, calls } = fakeFetch([
      ['/oauth/token', tokenResponse('app')],
      [
        '/tracks?',
        { collection: [scTrack(1), scTrack(3, { access: 'preview' }), scTrack(2, { access: 'blocked' }), scTrack(4, { streamable: false })] },
      ],
    ]);
    const tracks = await new SoundCloudProvider(options, impl).getArtistTracks({ externalId: 'soundcloud:users:7', name: 'producer' });
    assert.match(calls[1].url, /\/users\/soundcloud%3Ausers%3A7\/tracks\?limit=50/);
    assert.deepEqual(
      tracks.map((t) => [t.externalId, t.isPreview]),
      [
        ['soundcloud:tracks:3', true],
        ['soundcloud:tracks:1', false],
      ],
    );
    assert.equal(tracks[1].duration, 185);
    assert.equal(tracks[1].coverUrl, 'https://i1.sndcdn.com/artworks-1-t500x500.jpg');
    assert.equal(tracks[1].releasedAt, '2026-10-01T10:00:00.000Z');
    assert.equal(tracks[1].genre, 'Lo-Fi');
  });

  it('resolves the stream redirect to a signed CDN URL', async () => {
    const { impl, calls } = fakeFetch([
      ['/oauth/token', tokenResponse('app')],
      ['/streams/http', new Response(null, { status: 302, headers: { location: 'https://cf-media.sndcdn.com/abc.mp3?Policy=x' } })],
      ['/streams', { http_mp3_128_url: 'https://api.soundcloud.com/tracks/soundcloud:tracks:1/streams/http?x=1', hls_aac_160_url: 'https://h/1.m3u8' }],
    ]);
    const source = await new SoundCloudProvider(options, impl).resolveStream({ externalId: 'soundcloud:tracks:1', streamUrl: null, extra: null });
    assert.deepEqual(source, { url: 'https://cf-media.sndcdn.com/abc.mp3?Policy=x', kind: 'direct' });
    assert.equal(calls.at(-1)?.init?.redirect, 'manual');
    assert.equal(auth(calls.at(-1)?.init), 'OAuth app');
  });

  it('builds a PKCE authorize URL and exchanges the code with credentials in the body', async () => {
    const { impl, calls } = fakeFetch([['/oauth/token', tokenResponse('user')]]);
    const provider = new SoundCloudProvider(options, impl);
    const url = new URL(provider.oauth.authorizeUrl({ state: 's', codeChallenge: 'c', redirectUri: 'http://localhost/cb' }));
    assert.equal(url.origin + url.pathname, 'https://secure.soundcloud.com/authorize');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('response_type'), 'code');

    const tokens = await provider.oauth.exchangeCode({ code: 'abc', codeVerifier: 'v', redirectUri: 'http://localhost/cb' });
    assert.equal(tokens.accessToken, 'user');
    assert.equal(tokens.refreshToken, 'user-refresh');
    assert.ok(tokens.expiresAt && Date.parse(tokens.expiresAt) > Date.now());
    const body = form(calls[0].init);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code_verifier'), 'v');
    assert.equal(body.get('client_secret'), 'secret');
    assert.equal(auth(calls[0].init), undefined);
  });

  it('pages through likes with the user token', async () => {
    const { impl, calls } = fakeFetch([
      ['cursor=2', { collection: [scTrack(2)], next_href: null }],
      ['/me/likes/tracks', { collection: [scTrack(1)], next_href: 'https://api.soundcloud.com/me/likes/tracks?cursor=2' }],
    ]);
    const tracks = await new SoundCloudProvider(options, impl).getUserLibrary({ token: 'user' });
    assert.equal(tracks.length, 2);
    assert.ok(calls.every((c) => auth(c.init) === 'OAuth user'));
    await assert.rejects(new SoundCloudProvider(options, impl).getUserLibrary({}), (e: unknown) => e instanceof ProviderError);
  });
});

describe('SoundCloud account linking', () => {
  let grants: URLSearchParams[] = [];
  const { impl } = fakeFetch([
    [
      '/oauth/token',
      (_url: string, init?: RequestInit) => {
        const body = form(init);
        grants.push(body);
        return tokenResponse(body.get('grant_type') === 'refresh_token' ? 'user-2' : 'user-1');
      },
    ],
    ['/me/followings', { collection: [{ id: 7, urn: 'soundcloud:users:7', username: 'producer' }, { id: 8, urn: 'soundcloud:users:8', username: 'singer' }] }],
    ['/me/likes/tracks', (_url: string, init?: RequestInit) => (auth(init) === 'OAuth user-2' ? { collection: [scTrack(1)] } : new Response('{}', { status: 401 }))],
    ['/me', { id: 99, urn: 'soundcloud:users:99', username: 'listener', full_name: 'Мария' }],
    ['/tracks?', { collection: [scTrack(5)] }],
  ]);
  const t = createTestApp([new SoundCloudProvider({ clientId: 'cid', clientSecret: 'secret' }, impl)], impl);
  after(t.cleanup);
  let user: Awaited<ReturnType<typeof register>>;

  before(async () => {
    user = await register(t.request, 'maria');
  });

  it('runs the OAuth login with PKCE and stores the account', async () => {
    const start = await t.request.post('/api/services/soundcloud/oauth/start').set(user.auth).expect(200);
    const url = new URL(start.body.url);
    const state = url.searchParams.get('state')!;
    assert.match(url.searchParams.get('redirect_uri')!, /\/api\/services\/soundcloud\/oauth\/callback$/);

    const callback = await t.request.get('/api/services/soundcloud/oauth/callback').query({ state, code: 'the-code' }).expect(302);
    assert.equal(callback.headers.location, '/sync?connected=soundcloud');

    const exchange = grants.find((g) => g.get('grant_type') === 'authorization_code')!;
    const challenge = crypto.createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url');
    assert.equal(challenge, url.searchParams.get('code_challenge'));
    assert.equal(exchange.get('redirect_uri'), url.searchParams.get('redirect_uri'));

    const services = await t.request.get('/api/services').set(user.auth).expect(200);
    const sc = services.body.find((s: { id: string }) => s.id === 'soundcloud');
    assert.equal(sc.connected, true);
    assert.equal(sc.account.displayName, 'Мария');
    assert.equal(sc.connectMode, 'oauth');

    const reused = await t.request.get('/api/services/soundcloud/oauth/callback').query({ state, code: 'again' }).expect(302);
    const query = new URLSearchParams(reused.headers.location.split('?')[1]);
    assert.match(query.get('error')!, /Сессия входа устарела/);
  });

  it('refreshes an expired user token before importing likes', async () => {
    t.ctx.db.prepare(`UPDATE service_connections SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
    const res = await t.request.post('/api/services/soundcloud/import').set(user.auth).expect(200);
    assert.equal(res.body.imported, 1);
    assert.ok(grants.some((g) => g.get('grant_type') === 'refresh_token' && g.get('refresh_token') === 'user-1-refresh'));
    const playlist = await t.request.get(`/api/playlists/${res.body.playlistId}`).set(user.auth).expect(200);
    assert.equal(playlist.body.title, 'SoundCloud: лайки');
  });

  it('subscribes to everyone the user follows', async () => {
    const res = await t.request.post('/api/services/soundcloud/import-followings').set(user.auth).expect(200);
    assert.deepEqual(res.body, { found: 2, subscribed: 2 });
    const subs = await t.request.get('/api/subscriptions').set(user.auth).expect(200);
    assert.deepEqual(
      subs.body.map((a: { name: string }) => a.name),
      ['producer', 'singer'],
    );
    const again = await t.request.post('/api/services/soundcloud/import-followings').set(user.auth).expect(200);
    assert.equal(again.body.subscribed, 0);
  });

  it('rejects OAuth for token-based or unknown flows', async () => {
    await t.request.post('/api/services/soundcloud/connect').set(user.auth).send({ accessToken: 'x'.repeat(20) }).expect(400);
    await t.request.post('/api/services/soundcloud/oauth/start').expect(401);
  });
});
