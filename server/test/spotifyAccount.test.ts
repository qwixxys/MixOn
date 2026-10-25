import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { itemSong } from '../src/lib/spotifyAccount.js';
import type { ExternalTrack, MusicProvider } from '../src/providers/index.js';
import { createTestApp, fakeFetch, register, track } from './helpers.js';

const CLIENT = '0123456789abcdef0123456789abcdef';
const song = (name: string, artist: string, seconds: number) => ({ track: { type: 'track', name, artists: [{ name: artist }], duration_ms: seconds * 1000 } });

/** A service with full tracks that finds the given songs by their title. */
function service(songs: ExternalTrack[]): MusicProvider {
  return {
    id: 'soundcloud',
    name: 'SoundCloud',
    description: '',
    requiresToken: false,
    connectMode: null,
    fullTracks: true,
    proxyStreams: false,
    isConfigured: () => true,
    searchArtists: async () => [],
    getArtistTracks: async () => [],
    resolveStream: async () => null,
    searchTracks: async (q) => songs.filter((s) => q.toLowerCase().includes(s.title.toLowerCase())),
  };
}

describe('Spotify account', () => {
  it('reads songs from both answer shapes, leaving out episodes and local files', () => {
    assert.deepEqual(itemSong(song('Song', 'Band', 200)), { title: 'Song', artist: 'Band', duration: 200 });
    assert.deepEqual(itemSong({ item: { type: 'track', name: 'New', artists: [{ name: 'A' }, { name: 'B' }], duration_ms: 1000 } }), {
      title: 'New',
      artist: 'A, B',
      duration: 1,
    });
    assert.equal(itemSong({ item: { type: 'episode', name: 'Talk' } }), null);
    assert.equal(itemSong({ track: { type: 'track', name: 'Mine', is_local: true } }), null);
    assert.equal(itemSong({ track: null }), null);
  });

  let tokenCalls: URLSearchParams[] = [];
  let expiresIn = 3600;
  const { impl, calls } = fakeFetch([
    [
      'accounts.spotify.com/api/token',
      (_url: string, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        tokenCalls.push(body);
        if (body.get('code') === 'bad') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        return { access_token: `access-${tokenCalls.length}`, refresh_token: 'refresh', expires_in: expiresIn };
      },
    ],
    ['api.spotify.com/v1/me/tracks?limit=1', { items: [], total: 3 }],
    [
      'api.spotify.com/v1/me/tracks?limit=50',
      { items: [song('Liked One', 'Band', 200), song('Liked Two', 'Band', 180), { track: { type: 'episode', name: 'Pod' } }], total: 3, next: null },
    ],
    ['api.spotify.com/v1/me/playlists', { items: [{ id: 'P'.repeat(22), name: 'Закрытый', images: [{ url: 'p.jpg' }], owner: { display_name: 'Я' }, items: { total: 2 } }], next: null }],
    // An older app: the playlist's songs are at /tracks.
    [`api.spotify.com/v1/playlists/${'P'.repeat(22)}/items`, new Response('', { status: 404 })],
    [`api.spotify.com/v1/playlists/${'P'.repeat(22)}/tracks`, { items: [song('Liked One', 'Band', 200), song('Nowhere', 'Nobody', 100)], total: 2, next: null }],
    [`api.spotify.com/v1/playlists/${'P'.repeat(22)}?`, { id: 'P'.repeat(22), name: 'Закрытый' }],
    ['api.spotify.com/v1/me', { id: 'spotify-user', display_name: 'Аня' }],
  ]);
  const t = createTestApp(
    [service([track('l1', { title: 'Liked One', artist: 'Band', duration: 200 }), track('l2', { title: 'Liked Two', artist: 'Band', duration: 180 })])],
    impl,
  );
  after(t.cleanup);
  let user: Awaited<ReturnType<typeof register>>;
  const signIn = async () => {
    const { body } = await t.request
      .post('/api/spotify/login')
      .set(user.auth)
      .send({ clientId: CLIENT, redirectUri: 'http://127.0.0.1:4777/api/spotify/callback' })
      .expect(200);
    const url = new URL(body.url);
    return url.searchParams.get('state')!;
  };

  it('signs in through the listener’s own Spotify app with PKCE', async () => {
    user = await register(t.request, 'spotifan');
    assert.deepEqual((await t.request.get('/api/spotify').set(user.auth).expect(200)).body, { connected: false, displayName: null, clientId: null });
    await t.request.post('/api/spotify/login').set(user.auth).send({ clientId: 'nope', redirectUri: 'mixon://spotify-callback' }).expect(400);
    await t.request.post('/api/spotify/login').set(user.auth).send({ clientId: CLIENT, redirectUri: 'https://evil.example/steal' }).expect(400);

    const { body } = await t.request.post('/api/spotify/login').set(user.auth).send({ clientId: CLIENT, redirectUri: 'mixon://spotify-callback' }).expect(200);
    const url = new URL(body.url);
    assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
    assert.equal(url.searchParams.get('client_id'), CLIENT);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'user-library-read playlist-read-private playlist-read-collaborative');
    assert.equal(url.searchParams.get('redirect_uri'), 'mixon://spotify-callback');

    // The phone app hands the code over.
    const status = await t.request.post('/api/spotify/callback').set(user.auth).send({ state: url.searchParams.get('state'), code: 'good' }).expect(200);
    assert.deepEqual(status.body, { connected: true, displayName: 'Аня', clientId: CLIENT });
    const exchange = tokenCalls.at(-1)!;
    assert.deepEqual([exchange.get('grant_type'), exchange.get('client_id'), exchange.get('redirect_uri')], ['authorization_code', CLIENT, 'mixon://spotify-callback']);
    assert.ok(exchange.get('code_verifier'));
    // A state is good once.
    await t.request.post('/api/spotify/callback').set(user.auth).send({ state: url.searchParams.get('state'), code: 'good' }).expect(400);
  });

  it('finishes a browser sign-in on its callback page', async () => {
    const state = await signIn();
    const res = await t.request.get(`/api/spotify/callback?state=${state}&code=good`).expect(302);
    assert.equal(res.headers.location, '/sync?connected=spotify');
    const denied = await t.request.get(`/api/spotify/callback?state=${await signIn()}&error=access_denied`).expect(302);
    assert.equal(new URL(denied.headers.location, 'http://x').searchParams.get('error'), 'Spotify: вход отменён');
  });

  it('lists the library and imports liked songs and private playlists', async () => {
    const library = await t.request.get('/api/spotify/library').set(user.auth).expect(200);
    assert.deepEqual(library.body, { liked: 3, playlists: [{ id: 'P'.repeat(22), name: 'Закрытый', total: 2, image: 'p.jpg', owner: 'Я' }] });

    const liked = await t.request.post('/api/spotify/import').set(user.auth).send({ list: 'liked' }).expect(201);
    assert.deepEqual([liked.body.title, liked.body.imported, liked.body.missing], ['Spotify: любимые треки', 2, 0]);
    const playlist = await t.request.post('/api/spotify/import').set(user.auth).send({ list: 'P'.repeat(22) }).expect(201);
    assert.deepEqual([playlist.body.title, playlist.body.imported, playlist.body.missing], ['Закрытый', 1, 1]);
    assert.ok(calls.some((c) => c.url.includes('/tracks?limit=50') && c.url.includes('/playlists/')), 'fell back to /tracks');
    await t.request.post('/api/spotify/import').set(user.auth).send({ list: '../me' }).expect(400);
  });

  it('refreshes the token with the listener’s client id, and signs out', async () => {
    expiresIn = 1; // already within the minute before it runs out
    await signIn().then((state) => t.request.get(`/api/spotify/callback?state=${state}&code=good`));
    tokenCalls = [];
    await t.request.get('/api/spotify/library').set(user.auth).expect(200);
    assert.deepEqual([tokenCalls[0]?.get('grant_type'), tokenCalls[0]?.get('client_id')], ['refresh_token', CLIENT]);
    await t.request.delete('/api/spotify').set(user.auth).expect(200);
    assert.equal((await t.request.get('/api/spotify').set(user.auth).expect(200)).body.connected, false);
    await t.request.get('/api/spotify/library').set(user.auth).expect(400);
  });
});
