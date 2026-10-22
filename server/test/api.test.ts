import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestApp, FakeProvider, fakeFetch, register, sineWav, track } from './helpers.js';
import type { ProviderContext, StoredExternalTrack, StreamSource } from '../src/providers/index.js';

describe('auth', () => {
  const t = createTestApp();
  after(t.cleanup);

  it('registers, logs in and returns the current user', async () => {
    const { auth } = await register(t.request, 'alice');
    const login = await t.request.post('/api/auth/login').send({ login: 'ALICE@example.com', password: 'secret123' }).expect(200);
    assert.ok(login.body.token);
    const me = await t.request.get('/api/auth/me').set(auth).expect(200);
    assert.equal(me.body.user.username, 'alice');
    assert.equal(me.body.user.displayName, 'alice');
  });

  it('rejects duplicates, bad passwords and invalid input', async () => {
    await t.request.post('/api/auth/register').send({ username: 'Alice', email: 'other@example.com', password: 'secret123' }).expect(409);
    await t.request.post('/api/auth/login').send({ login: 'alice', password: 'wrong' }).expect(401);
    const bad = await t.request.post('/api/auth/register').send({ username: 'a', email: 'nope', password: '1' }).expect(400);
    assert.match(bad.body.error, /username/);
    await t.request.get('/api/auth/me').expect(401);
    await t.request.get('/api/auth/me').set({ Authorization: 'Bearer garbage' }).expect(401);
  });
});

describe('tracks', () => {
  const t = createTestApp();
  after(t.cleanup);
  let alice: Awaited<ReturnType<typeof register>>;
  let bob: Awaited<ReturnType<typeof register>>;
  let trackId: number;

  before(async () => {
    alice = await register(t.request, 'alice');
    bob = await register(t.request, 'bob');
    await t.request.post('/api/users/alice/follow').set(bob.auth).expect(200);
  });

  it('uploads audio with metadata and a waveform', async () => {
    const waveform = Array.from({ length: 50 }, (_, i) => (i % 10) + 1);
    const res = await t.request
      .post('/api/tracks')
      .set(alice.auth)
      .field('title', 'Первый трек')
      .field('genre', 'Ambient')
      .field('waveform', JSON.stringify(waveform))
      .attach('audio', sineWav(2), { filename: 'demo.wav', contentType: 'audio/wav' })
      .expect(201);
    trackId = res.body.id;
    assert.equal(res.body.title, 'Первый трек');
    assert.equal(res.body.artist, 'alice');
    assert.equal(res.body.source, 'local');
    assert.equal(Math.round(res.body.duration), 2);
    assert.equal(res.body.waveform.length, 50);
    assert.equal(Math.max(...res.body.waveform), 1);
    assert.equal(res.body.uploader.username, 'alice');
  });

  it('rejects non-audio uploads and anonymous uploads', async () => {
    await t.request
      .post('/api/tracks')
      .set(alice.auth)
      .attach('audio', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);
    await t.request.post('/api/tracks').attach('audio', sineWav(), { filename: 'a.wav', contentType: 'audio/wav' }).expect(401);
  });

  it('never serves an upload with a type taken from an untrusted extension', async () => {
    const res = await t.request
      .post('/api/tracks')
      .set(alice.auth)
      .field('title', 'evil')
      .attach('audio', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.html', contentType: 'audio/mpeg' })
      .expect(201);
    const stream = await t.request.get(`/api/tracks/${res.body.id}/stream`).expect(200);
    assert.equal(stream.headers['content-type'], 'audio/mpeg');
    assert.equal(stream.headers['x-content-type-options'], 'nosniff');
    await t.request.delete(`/api/tracks/${res.body.id}`).set(alice.auth).expect(200);
  });

  it('streams local audio with range support', async () => {
    const source = await t.request.get(`/api/tracks/${trackId}/source`).expect(200);
    assert.deepEqual(source.body, { kind: 'direct', url: `/api/tracks/${trackId}/stream` });
    const full = await t.request.get(source.body.url).buffer(true).expect(200);
    assert.equal(Number(full.headers['content-length']), sineWav(2).length);
    const part = await t.request.get(source.body.url).set('Range', 'bytes=0-99').buffer(true).expect(206);
    assert.equal(part.headers['content-range'], `bytes 0-99/${sineWav(2).length}`);
  });

  it('notifies followers about uploads and shows them in the feed', async () => {
    const count = await t.request.get('/api/me/notifications/unread-count').set(bob.auth).expect(200);
    assert.equal(count.body.count, 1);
    const list = await t.request.get('/api/me/notifications').set(bob.auth).expect(200);
    assert.equal(list.body[0].type, 'new_upload');
    assert.equal(list.body[0].track.id, trackId);
    await t.request.post('/api/me/notifications/read').set(bob.auth).expect(200);
    assert.equal((await t.request.get('/api/me/notifications/unread-count').set(bob.auth)).body.count, 0);

    const feed = await t.request.get('/api/feed').set(bob.auth).expect(200);
    assert.deepEqual(
      feed.body.map((x: { id: number }) => x.id),
      [trackId],
    );
  });

  it('likes, plays, comments and history', async () => {
    const like = await t.request.post(`/api/tracks/${trackId}/like`).set(bob.auth).expect(200);
    assert.deepEqual(like.body, { liked: true, likeCount: 1 });
    await t.request.post(`/api/tracks/${trackId}/play`).set(bob.auth).expect(200);
    const replay = await t.request.post(`/api/tracks/${trackId}/play`).set(bob.auth).expect(200);
    assert.equal(replay.body.playCount, 1, 'repeated plays within 30s count once');

    const comment = await t.request
      .post(`/api/tracks/${trackId}/comments`)
      .set(bob.auth)
      .send({ body: 'Огонь!', atSeconds: 1.5 })
      .expect(201);
    const comments = await t.request.get(`/api/tracks/${trackId}/comments`).set(alice.auth).expect(200);
    assert.equal(comments.body[0].body, 'Огонь!');
    assert.equal(comments.body[0].atSeconds, 1.5);
    assert.equal(comments.body[0].canDelete, true, 'track owner can moderate');

    const track = await t.request.get(`/api/tracks/${trackId}`).set(bob.auth).expect(200);
    assert.equal(track.body.liked, true);
    assert.equal(track.body.commentCount, 1);
    assert.equal(track.body.playCount, 1);

    const history = await t.request.get('/api/me/history').set(bob.auth).expect(200);
    assert.equal(history.body[0].id, trackId);
    const likes = await t.request.get('/api/users/bob/likes').expect(200);
    assert.equal(likes.body[0].id, trackId);

    await t.request.delete(`/api/tracks/${trackId}/comments/${comment.body.id}`).set(alice.auth).expect(200);
  });

  it('only lets the owner edit or delete', async () => {
    await t.request.patch(`/api/tracks/${trackId}`).set(bob.auth).send({ title: 'hijack' }).expect(403);
    const edited = await t.request.patch(`/api/tracks/${trackId}`).set(alice.auth).send({ title: 'Новое имя' }).expect(200);
    assert.equal(edited.body.title, 'Новое имя');
  });

  it('searches case-insensitively in Cyrillic', async () => {
    const res = await t.request.get('/api/search').query({ q: 'НОВОЕ' }).expect(200);
    assert.equal(res.body.tracks[0].id, trackId);
    const users = await t.request.get('/api/search').query({ q: 'ALI' }).expect(200);
    assert.equal(users.body.users[0].username, 'alice');
  });

  it('manages playlists with privacy', async () => {
    const created = await t.request
      .post('/api/playlists')
      .set(alice.auth)
      .send({ title: 'Секретный', isPublic: false, trackIds: [trackId] })
      .expect(201);
    assert.equal(created.body.trackCount, 1);
    await t.request.get(`/api/playlists/${created.body.id}`).set(bob.auth).expect(404);
    const own = await t.request.get(`/api/playlists/${created.body.id}`).set(alice.auth).expect(200);
    assert.equal(own.body.tracks[0].id, trackId);
    await t.request.post(`/api/playlists/${created.body.id}/tracks`).set(bob.auth).send({ trackId }).expect(404);
    const emptied = await t.request.delete(`/api/playlists/${created.body.id}/tracks/${trackId}`).set(alice.auth).expect(200);
    assert.equal(emptied.body.trackCount, 0);
  });

  it('deletes tracks and their files', async () => {
    await t.request.delete(`/api/tracks/${trackId}`).set(alice.auth).expect(200);
    await t.request.get(`/api/tracks/${trackId}`).expect(404);
  });
});

describe('services and subscriptions', () => {
  const provider = new FakeProvider();
  const t = createTestApp([provider]);
  after(t.cleanup);
  let alice: Awaited<ReturnType<typeof register>>;

  before(async () => {
    alice = await register(t.request, 'alice');
    provider.tracks = [track('1', { title: 'Сингл', coverUrl: 'https://img/1.jpg' }), track('2')];
  });

  it('lists services', async () => {
    const res = await t.request.get('/api/services').set(alice.auth).expect(200);
    assert.equal(res.body[0].id, 'deezer');
    assert.equal(res.body[0].available, true);
  });

  it('subscribes to an artist and imports their tracks immediately', async () => {
    const found = await t.request.get('/api/services/deezer/artists').query({ q: 'Artist' }).set(alice.auth).expect(200);
    assert.equal(found.body[0].isSubscribed, false);

    const res = await t.request
      .post('/api/subscriptions')
      .set(alice.auth)
      .send({ provider: 'deezer', externalId: 'a1', name: 'Artist' })
      .expect(201);
    assert.equal(res.body.sync.newTracks, 2);
    assert.equal(res.body.artist.trackCount, 2);
    assert.equal(res.body.artist.isSubscribed, true);

    const again = await t.request.get('/api/services/deezer/artists').query({ q: 'Artist' }).set(alice.auth).expect(200);
    assert.equal(again.body[0].isSubscribed, true);

    const artist = await t.request.get(`/api/artists/${res.body.artist.id}`).set(alice.auth).expect(200);
    assert.equal(artist.body.tracks.length, 2);
    assert.equal(artist.body.tracks[0].externalArtist.provider, 'deezer');

    const releases = await t.request.get('/api/feed').query({ type: 'releases' }).set(alice.auth).expect(200);
    assert.equal(releases.body.length, 2);
  });

  it('rejects non-http artist links', async () => {
    const res = await t.request
      .post('/api/subscriptions')
      .set(alice.auth)
      .send({ provider: 'deezer', externalId: 'x', name: 'X', url: 'javascript:alert(1)' })
      .expect(400);
    assert.match(res.body.error, /http/);
  });

  it('reports new releases on manual sync', async () => {
    provider.tracks = [track('3', { title: 'Свежак' }), ...provider.tracks];
    const res = await t.request.post('/api/sync').set(alice.auth).expect(200);
    assert.deepEqual(res.body, { artists: 1, newTracks: 1, errors: [] });
    const notes = await t.request.get('/api/me/notifications').set(alice.auth).expect(200);
    assert.equal(notes.body[0].type, 'new_release');
    assert.equal(notes.body[0].track.title, 'Свежак');
  });

  it('redirects to the service for external playback', async () => {
    const [first] = (await t.request.get('/api/feed').set(alice.auth)).body;
    const source = await t.request.get(`/api/tracks/${first.id}/source`).expect(200);
    assert.deepEqual(source.body, { url: 'https://cdn.example/3.mp3', kind: 'direct' });
    const stream = await t.request.get(`/api/tracks/${first.id}/stream`).expect(302);
    assert.equal(stream.headers.location, 'https://cdn.example/3.mp3');
  });

  it('unsubscribes', async () => {
    const [sub] = (await t.request.get('/api/subscriptions').set(alice.auth)).body;
    await t.request.delete(`/api/subscriptions/${sub.id}`).set(alice.auth).expect(200);
    assert.equal((await t.request.get('/api/subscriptions').set(alice.auth)).body.length, 0);
  });
});

describe('proxied streams (VK-like services)', () => {
  const audioBytes = Buffer.from('ID3-fake-mp3-bytes');
  const { impl, calls } = fakeFetch([
    [
      'cdn.vk.example',
      new Response(audioBytes, { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': String(audioBytes.length) } }),
    ],
  ]);

  class ProxyProvider extends FakeProvider {
    override readonly requiresToken = true;
    override readonly connectMode = 'token' as const;
    override readonly proxyStreams = true;
    readonly streamHeaders = { 'user-agent': 'KateMobile' };
    tokens: (string | null | undefined)[] = [];
    override async resolveStream(_t: StoredExternalTrack, ctx?: ProviderContext): Promise<StreamSource> {
      this.tokens.push(ctx?.token);
      return { url: 'https://cdn.vk.example/a.mp3', kind: 'direct' as const };
    }
    async verifyToken(token: string) {
      if (token !== 'good-token') throw new Error('bad token');
      return { externalUserId: '1', displayName: 'Иван' };
    }
  }
  const provider = new ProxyProvider();
  const t = createTestApp([provider], impl);
  after(t.cleanup);

  it('relays audio through the server using the listener’s own token', async () => {
    const alice = await register(t.request, 'alice');
    const connected = await t.request
      .post('/api/services/deezer/connect')
      .set(alice.auth)
      .send({ accessToken: 'https://oauth.vk.com/blank.html#access_token=good-token&expires_in=0&user_id=1' })
      .expect(200);
    assert.equal(connected.body.connected, true);
    assert.equal(connected.body.account.displayName, 'Иван');

    t.ctx.sync.storeTracks([track('vk1')], 'deezer', null);
    const { id } = t.ctx.db.prepare(`SELECT id FROM tracks WHERE external_id = 'vk1'`).get() as { id: number };

    const source = await t.request.get(`/api/tracks/${id}/source`).set(alice.auth).expect(200);
    assert.equal(source.body.kind, 'direct');
    assert.match(source.body.url, new RegExp(`^/api/tracks/${id}/stream\\?t=`));

    // The <audio> element has no Authorization header; the signed URL carries the user.
    const res = await t.request.get(source.body.url).buffer(true).expect(200);
    assert.equal(res.headers['content-type'], 'audio/mpeg');
    assert.equal(Buffer.from(res.body).toString(), audioBytes.toString());
    assert.deepEqual(provider.tokens, ['good-token']);
    assert.equal((calls.at(-1)?.init?.headers as Record<string, string>)['user-agent'], 'KateMobile');
  });
});
