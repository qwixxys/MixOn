import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DeezerProvider } from '../src/providers/deezer.js';
import { createTestApp, fakeFetch, register } from './helpers.js';

const dzTrack = (id: number, title: string) => ({
  id,
  title,
  duration: 200,
  preview: `https://cdn.example/${id}.mp3`,
  link: `https://www.deezer.com/track/${id}`,
  artist: { id: 7, name: 'Группа' },
  album: { id: 70, title: 'Альбом', cover_big: 'https://img.example/c.jpg' },
});

describe('app-wide search on services', () => {
  const { impl } = fakeFetch([
    ['api.deezer.com/search/artist', { data: [{ id: 7, name: 'Группа', link: 'https://www.deezer.com/artist/7', nb_fan: 1200 }] }],
    ['api.deezer.com/search/track', { data: [dzTrack(1, 'Первая'), dzTrack(2, 'Вторая')] }],
    ['api.deezer.com/artist/7/albums', { data: [] }],
  ]);
  const t = createTestApp([new DeezerProvider(impl)], impl);
  after(t.cleanup);
  let user: { auth: Record<string, string> };
  before(async () => {
    user = await register(t.request, 'listener');
  });

  it('finds artists and playable tracks, stored once', async () => {
    const res = await t.request.get('/api/services/deezer/search').query({ q: 'группа' }).set(user.auth).expect(200);
    assert.deepEqual(
      res.body.artists.map((a: { name: string; provider: string; isSubscribed: boolean }) => [a.name, a.provider, a.isSubscribed]),
      [['Группа', 'deezer', false]],
    );
    assert.deepEqual(res.body.tracks.map((tr: { title: string }) => tr.title), ['Первая', 'Вторая']);
    assert.ok(res.body.tracks.every((tr: { id: number; source: string }) => tr.id > 0 && tr.source === 'deezer'));

    const again = await t.request.get('/api/services/deezer/search').query({ q: 'группа' }).set(user.auth).expect(200);
    assert.deepEqual(again.body.tracks.map((tr: { id: number }) => tr.id), res.body.tracks.map((tr: { id: number }) => tr.id));

    await t.request.post('/api/subscriptions').set(user.auth).send({ provider: 'deezer', externalId: '7', name: 'Группа' }).expect(201);
    const subscribed = await t.request.get('/api/services/deezer/search').query({ q: 'группа' }).set(user.auth).expect(200);
    assert.equal(subscribed.body.artists[0].isSubscribed, true);
  });

  it('keeps found tracks out of trending until someone plays them', async () => {
    const discover = await t.request.get('/api/discover').expect(200);
    assert.equal(discover.body.trending.length, 0);
    const [first] = (await t.request.get('/api/services/deezer/search').query({ q: 'группа' }).set(user.auth).expect(200)).body.tracks;
    await t.request.post(`/api/tracks/${first.id}/play`).set(user.auth).expect(200);
    const after = await t.request.get('/api/discover').expect(200);
    assert.deepEqual(after.body.trending.map((tr: { id: number }) => tr.id), [first.id]);
  });

  it('forgets found tracks nobody kept', async () => {
    const { tracks } = (await t.request.get('/api/services/deezer/search').query({ q: 'группа' }).set(user.auth).expect(200)).body;
    const [played, unused] = tracks as { id: number }[];
    const extra = t.ctx.sync.storeTracks(
      [{ ...trackFrom(3, 'Лайкнутая') }, { ...trackFrom(4, 'В плейлисте') }, { ...trackFrom(5, 'Лишняя') }],
      'deezer',
      null,
    ).ids;
    await t.request.post(`/api/tracks/${extra[0]}/like`).set(user.auth).expect(200);
    const playlist = await t.request.post('/api/playlists').set(user.auth).send({ title: 'Мой' }).expect(201);
    await t.request.post(`/api/playlists/${playlist.body.id}/tracks`).set(user.auth).send({ trackId: extra[1] }).expect(200);

    assert.equal(t.ctx.sync.pruneUnusedTracks(), 0, 'recent tracks stay');
    t.ctx.db.prepare(`UPDATE tracks SET created_at = '2020-01-01T00:00:00.000Z'`).run();
    const removed = t.ctx.sync.pruneUnusedTracks();
    const left = new Set((t.ctx.db.prepare('SELECT id FROM tracks').all() as { id: number }[]).map((r) => r.id));
    assert.equal(left.has(played.id), true, 'played');
    assert.equal(left.has(extra[0]), true, 'liked');
    assert.equal(left.has(extra[1]), true, 'in a playlist');
    assert.equal(left.has(unused.id), false, 'never used');
    assert.equal(left.has(extra[2]), false, 'never used either');
    assert.equal(removed, 2);
  });

  it('reports a service that fails', async () => {
    const broken = fakeFetch([['api.deezer.com', { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } }]]);
    const t2 = createTestApp([new DeezerProvider(broken.impl)], broken.impl);
    try {
      const res = await t2.request.get('/api/services/deezer/search').query({ q: 'x' }).expect(502);
      assert.match(res.body.error, /Quota/);
    } finally {
      t2.cleanup();
    }
  });
});

function trackFrom(id: number, title: string) {
  return {
    externalId: String(id),
    title,
    artist: 'Группа',
    album: null,
    duration: 200,
    streamUrl: null,
    coverUrl: null,
    externalUrl: null,
    releasedAt: null,
    genre: null,
    isPreview: true,
  };
}
