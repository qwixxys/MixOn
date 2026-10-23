import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { GeniusArtistFullRaw, GeniusHitRaw } from '../src/genius/client.js';
import { pickArtist, toGeniusArtist } from '../src/genius/service.js';
import { createTestApp, fakeFetch, FakeProvider } from './helpers.js';

// All artists, songs and texts below are invented for the tests.
const hit = (id: number, title: string, artistId: number, by: string): GeniusHitRaw => ({
  id,
  title,
  full_title: `${title} by ${by}`,
  url: `https://genius.com/songs/${id}`,
  primary_artist: { id: artistId, name: by, url: `https://genius.com/artists/${artistId}` },
});
const fullArtist = (id: number, name: string, extra: Partial<GeniusArtistFullRaw> = {}): GeniusArtistFullRaw => ({
  id,
  name,
  url: `https://genius.com/artists/${id}`,
  image_url: `https://images.genius.com/artist-${id}.png`,
  header_image_url: `https://images.genius.com/header-${id}.png`,
  is_verified: true,
  followers_count: 321,
  alternate_names: ['Полярка'],
  description: { plain: 'Выдуманная группа для теста.' },
  instagram_name: '@polar_test',
  twitter_name: null,
  facebook_name: '',
  ...extra,
});

describe('Genius artist matching', () => {
  it('picks the artist whose name matches, the one with most hits', () => {
    const hits = [
      hit(1, 'Песня', 900, 'Genius English Translations'),
      hit(2, 'Небо', 10, 'Полярный Свет'),
      hit(3, 'Море', 10, 'Полярный Свет'),
      hit(4, 'Лес', 11, 'Полярный Свет'),
      hit(5, 'Поле', 12, 'Полярный Светлячок'),
    ];
    assert.equal(pickArtist(hits, 'Полярный Свет')?.id, 10);
    assert.equal(pickArtist(hits, 'Полярный Свет feat. Гость')?.id, 10, 'by the main performer');
    assert.equal(pickArtist(hits, 'Совсем Другой'), null);
  });

  it('matches names Genius writes with a translation in brackets', () => {
    const hits = [hit(1, 'Звезда', 20, 'Кино (Kino)')];
    assert.equal(pickArtist(hits, 'Кино')?.id, 20);
    assert.equal(pickArtist(hits, 'KINO')?.id, 20);
  });

  it('maps artist details for the client', () => {
    const artist = toGeniusArtist(fullArtist(10, 'Полярный Свет'), [hit(2, 'Небо', 10, 'Полярный Свет'), hit(9, 'Чужая', 99, 'Кто-то')]);
    assert.equal(artist.description, 'Выдуманная группа для теста.');
    assert.deepEqual(artist.links, [{ label: 'Instagram', url: 'https://www.instagram.com/polar_test' }]);
    assert.deepEqual(artist.popularSongs.map((s) => s.id), [2], 'only songs where they are the main artist');
    assert.equal(artist.verified, true);
    assert.equal(toGeniusArtist(fullArtist(10, 'X', { description: { plain: '?' } }), []).description, null);
  });
});

describe('GET /api/artists/:id/genius', () => {
  const calls = { search: 0, artist: 0 };
  const { impl } = fakeFetch([
    [
      'api.genius.com/search',
      (url: string) => {
        calls.search++;
        const q = new URL(url).searchParams.get('q') ?? '';
        const hits = q.includes('Полярный') ? [hit(2, 'Небо', 10, 'Полярный Свет'), hit(3, 'Море', 10, 'Полярный Свет')] : [];
        return { meta: { status: 200 }, response: { hits: hits.map((result) => ({ type: 'song', result })) } };
      },
    ],
    [
      /api\.genius\.com\/artists\/\d+\/songs/,
      { meta: { status: 200 }, response: { songs: [hit(2, 'Небо', 10, 'Полярный Свет')] } },
    ],
    [
      /api\.genius\.com\/artists\/\d+/,
      (url: string) => {
        calls.artist++;
        const id = Number(new URL(url).pathname.split('/').pop());
        return { meta: { status: 200 }, response: { artist: fullArtist(id, 'Полярный Свет') } };
      },
    ],
  ]);
  const t = createTestApp([new FakeProvider()], impl, 'genius-token');
  after(t.cleanup);
  const addArtist = (externalId: string, name: string) =>
    Number(
      t.ctx.db.prepare(`INSERT INTO external_artists (provider, external_id, name) VALUES ('deezer', ?, ?)`).run(externalId, name)
        .lastInsertRowid,
    );

  it('finds the artist on Genius when the page opens, and caches it', async () => {
    const id = addArtist('a1', 'Полярный Свет');
    const res = await t.request.get(`/api/artists/${id}/genius`).expect(200);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.artist.id, 10);
    assert.equal(res.body.artist.description, 'Выдуманная группа для теста.');
    assert.deepEqual(res.body.artist.popularSongs.map((s: { title: string }) => s.title), ['Небо']);
    await t.request.get(`/api/artists/${id}/genius`).expect(200);
    assert.deepEqual(calls, { search: 1, artist: 1 });
  });

  it('remembers artists Genius does not know', async () => {
    const id = addArtist('a2', 'Неизвестная Группа');
    assert.equal((await t.request.get(`/api/artists/${id}/genius`).expect(200)).body.artist, null);
    await t.request.get(`/api/artists/${id}/genius`).expect(200);
    assert.equal(calls.search, 2, 'no second search within the retry window');
  });

  it('answers 404 for unknown artists and says when Genius is not set up', async () => {
    await t.request.get('/api/artists/99999/genius').expect(404);
    const bare = createTestApp([new FakeProvider()], impl, null);
    try {
      const id = Number(
        bare.ctx.db.prepare(`INSERT INTO external_artists (provider, external_id, name) VALUES ('deezer', 'x', 'Полярный Свет')`).run()
          .lastInsertRowid,
      );
      assert.deepEqual((await bare.request.get(`/api/artists/${id}/genius`).expect(200)).body, { configured: false, artist: null });
    } finally {
      bare.cleanup();
    }
  });
});
