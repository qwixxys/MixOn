import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { migrate, openDatabase } from '../src/db/index.js';
import { normalizeGenre } from '../src/lib/genres.js';
import { createTestApp, FakeProvider, register, sineWav, track } from './helpers.js';

describe('normalizeGenre', () => {
  it('folds spellings from different services into one genre', () => {
    for (const raw of ['Hip-Hop/Rap', 'Rap & Hip-Hop', 'Rap/Hip Hop', 'Hip-hop & Rap', 'рэп', 'hip hop']) {
      assert.equal(normalizeGenre(raw), 'Хип-хоп', raw);
    }
    assert.equal(normalizeGenre('Drum and Bass'), 'Драм-н-бейс');
    assert.equal(normalizeGenre('Soul & Funk'), 'R&B и соул');
    assert.equal(normalizeGenre('Dance & EDM'), 'Танцевальная');
    assert.equal(normalizeGenre('  #lo-fi '), 'Лоу-фай');
  });

  it('keeps unknown genres, tidied, and drops meaningless ones', () => {
    assert.equal(normalizeGenre('synthwave'), 'Synthwave');
    assert.equal(normalizeGenre('Other'), null);
    assert.equal(normalizeGenre(''), null);
    assert.equal(normalizeGenre(null), null);
  });

  it('normalises genres stored before the migration', () => {
    const db = openDatabase(':memory:');
    db.pragma('user_version = 3');
    db.prepare(`INSERT INTO tracks (title, artist, genre) VALUES ('a', 'x', 'Rap/Hip Hop'), ('b', 'x', 'other'), ('c', 'x', 'Jazz')`).run();
    migrate(db);
    assert.deepEqual(
      db.prepare('SELECT genre FROM tracks ORDER BY id').all(),
      [{ genre: 'Хип-хоп' }, { genre: null }, { genre: 'Джаз' }],
    );
  });
});

describe('genre filters and sorting', () => {
  const provider = new FakeProvider();
  const t = createTestApp([provider]);
  after(t.cleanup);
  let user: Awaited<ReturnType<typeof register>>;

  before(async () => {
    user = await register(t.request, 'djmax');
    provider.tracks = [
      track('1', { title: 'Бит', genre: 'Rap/Hip Hop', releasedAt: '2026-01-03T00:00:00.000Z' }),
      track('2', { title: 'Аккорд', genre: 'Rock', releasedAt: '2026-01-02T00:00:00.000Z' }),
      track('3', { title: 'Волна', genre: 'Hip-Hop/Rap', releasedAt: '2026-01-01T00:00:00.000Z' }),
      track('4', { title: 'Тишина', genre: null, releasedAt: '2026-01-04T00:00:00.000Z' }),
    ];
    await t.request.post('/api/subscriptions').set(user.auth).send({ provider: 'deezer', externalId: 'a1', name: 'Artist' }).expect(201);
  });

  const titles = (res: { body: { title: string }[] }) => res.body.map((x) => x.title);

  it('stores normalised genres from services', async () => {
    const res = await t.request.get('/api/genres').query({ scope: 'feed:all' }).set(user.auth).expect(200);
    assert.deepEqual(
      res.body.genres.map((g: { name: string; count: number }) => [g.name, g.count]),
      [
        ['Хип-хоп', 2],
        ['Рок', 1],
      ],
    );
    assert.equal(res.body.untagged, 1);
    assert.equal(res.body.total, 4);
  });

  it('filters a list by genre, including untagged tracks', async () => {
    assert.deepEqual(titles(await t.request.get('/api/feed').query({ genre: 'hip hop' }).set(user.auth)), ['Бит', 'Волна']);
    assert.deepEqual(titles(await t.request.get('/api/feed').query({ genre: '-' }).set(user.auth)), ['Тишина']);
  });

  it('sorts by genre, keeping the natural order inside each genre', async () => {
    const res = await t.request.get('/api/feed').query({ sort: 'genre' }).set(user.auth).expect(200);
    assert.deepEqual(titles(res), ['Аккорд', 'Бит', 'Волна', 'Тишина']);
    const byTitle = await t.request.get('/api/tracks').query({ sort: 'title' }).expect(200);
    assert.deepEqual(titles(byTitle), ['Аккорд', 'Бит', 'Волна', 'Тишина']);
  });

  it('applies to likes, uploads and artist lists too', async () => {
    const [first] = (await t.request.get('/api/feed').set(user.auth)).body;
    await t.request.post(`/api/tracks/${first.id}/like`).set(user.auth).expect(200);
    const likes = await t.request.get('/api/genres').query({ scope: 'likes:djmax' }).expect(200);
    assert.equal(likes.body.total, 1);

    await t.request
      .post('/api/tracks')
      .set(user.auth)
      .field('title', 'Мой трек')
      .field('genre', 'drum n bass')
      .attach('audio', sineWav(), { filename: 'a.wav', contentType: 'audio/wav' })
      .expect(201);
    const uploads = await t.request.get('/api/users/djmax/tracks').query({ genre: 'Драм-н-бейс' }).expect(200);
    assert.deepEqual(titles(uploads), ['Мой трек']);

    const artistId = first.externalArtist.id;
    const artist = await t.request.get(`/api/artists/${artistId}/tracks`).query({ genre: 'Рок' }).expect(200);
    assert.deepEqual(titles(artist), ['Аккорд']);
  });

  it('rejects unknown lists', async () => {
    await t.request.get('/api/genres').query({ scope: 'nope' }).expect(400);
    await t.request.get('/api/genres').query({ scope: 'feed:all' }).expect(401);
  });
});
