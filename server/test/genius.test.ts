import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { GeniusHitRaw, GeniusSongRaw } from '../src/genius/client.js';
import { cleanTitle, pickMatch, primaryArtist, searchQuery, toGeniusSong } from '../src/genius/service.js';
import { createTestApp, fakeFetch, FakeProvider, register, sineWav, track } from './helpers.js';

// All artists, songs and texts below are invented for the tests.
const artist = (id: number, name: string) => ({ id, name, url: `https://genius.com/artists/${id}`, image_url: `https://images.genius.com/${id}.png` });
const hit = (id: number, title: string, by: string, extra: Partial<GeniusHitRaw> = {}): GeniusHitRaw => ({
  id,
  title,
  full_title: `${title} by ${by}`,
  url: `https://genius.com/songs/${id}`,
  primary_artist: artist(id * 10, by),
  song_art_image_thumbnail_url: `https://images.genius.com/song-${id}.png`,
  release_date_for_display: 'March 3, 2024',
  ...extra,
});
const song = (id: number, title: string, by: string, extra: Partial<GeniusSongRaw> = {}): GeniusSongRaw => ({
  ...hit(id, title, by),
  release_date: '2024-03-03',
  album: { id: 5, name: 'Тестовый альбом', url: 'https://genius.com/albums/5', cover_art_url: 'https://images.genius.com/album.png' },
  featured_artists: [artist(2, 'Гостевой Голос')],
  writer_artists: [artist(3, 'Автор Слов'), artist(4, 'Автор Музыки')],
  producer_artists: [artist(6, 'Продюсер Икс')],
  custom_performances: [{ label: 'Mixing Engineer', artists: [artist(7, 'Звукорежиссёр')] }, { label: 'Empty', artists: [] }],
  song_relationships: [
    { relationship_type: 'samples', songs: [hit(900, 'Старая пластинка', 'Ансамбль Прошлого')] },
    { relationship_type: 'remixed_by', songs: [] },
    { relationship_type: 'something_new', songs: [hit(901, 'x', 'y')] },
  ],
  media: [
    { provider: 'youtube', type: 'video', url: 'https://www.youtube.com/watch?v=test' },
    { provider: 'bad', url: 'javascript:alert(1)' },
  ],
  description: { plain: 'Выдуманное описание песни для теста.' },
  embed_content: `<div id='rg_embed_link_${id}' class='rg_embed_link' data-song-id='${id}'></div><script crossorigin src='//genius.com/songs/${id}/embed.js'></script>`,
  stats: { pageviews: 1234 },
  ...extra,
});

describe('Genius matching', () => {
  it('cleans titles and artists the way Genius names songs', () => {
    assert.equal(cleanTitle('Небо над крышами (feat. Гость) [Official Video]'), 'Небо над крышами');
    assert.equal(cleanTitle('Вечер - Remastered 2011'), 'Вечер');
    assert.equal(cleanTitle('Вечер (Ночной Remix)'), 'Вечер (Ночной Remix)');
    assert.equal(cleanTitle('Вечер ft. Друг'), 'Вечер');
    assert.equal(primaryArtist('Полярный Свет feat. Гость'), 'Полярный Свет');
    assert.equal(primaryArtist('Север, Юг'), 'Север');
    assert.equal(primaryArtist('Север x Юг'), 'Север');
    assert.equal(searchQuery({ title: 'Небо над крышами [Lyric Video]', artist: 'Полярный Свет & Друзья' }), 'Полярный Свет Небо над крышами');
  });

  it('picks the hit matching both title and artist', () => {
    const hits = [
      hit(1, 'Небо над крышами (English Translation)', 'Genius English Translations'),
      hit(2, 'Небо над крышами', 'Другая Группа'),
      hit(3, 'Небо над крышами', 'Полярный Свет'),
    ];
    assert.equal(pickMatch(hits, { title: 'Небо над крышами (feat. Гость)', artist: 'Полярный Свет' })?.id, 3);
    assert.equal(pickMatch(hits, { title: 'Совсем другая песня', artist: 'Полярный Свет' }), null);
  });

  it('understands SoundCloud-style "Artist - Title" uploads', () => {
    const hits = [hit(3, 'Небо над крышами', 'Полярный Свет')];
    assert.equal(pickMatch(hits, { title: 'Полярный Свет - Небо над крышами', artist: 'uploader123' })?.id, 3);
  });

  it('maps song details for the client', () => {
    const s = toGeniusSong(song(42, 'Небо над крышами', 'Полярный Свет'));
    assert.equal(s.album?.name, 'Тестовый альбом');
    assert.deepEqual(s.writers.map((p) => p.name), ['Автор Слов', 'Автор Музыки']);
    assert.deepEqual(s.producers.map((p) => p.name), ['Продюсер Икс']);
    assert.deepEqual(s.featured.map((p) => p.name), ['Гостевой Голос']);
    assert.deepEqual(s.credits, [{ label: 'Mixing Engineer', people: [{ id: 7, name: 'Звукорежиссёр', url: 'https://genius.com/artists/7', imageUrl: 'https://images.genius.com/7.png' }] }]);
    assert.deepEqual(s.relationships.map((r) => [r.label, r.songs.length]), [['Использует сэмплы', 1]]);
    assert.deepEqual(s.media, [{ provider: 'youtube', url: 'https://www.youtube.com/watch?v=test' }]);
    assert.match(s.embedContent ?? '', /genius\.com\/songs\/42\/embed\.js/);
    assert.equal(toGeniusSong(song(1, 'x', 'y', { description: { plain: '?' } })).description, null);
  });
});

describe('Genius API routes', () => {
  const calls = { search: 0, song: 0 };
  const { impl } = fakeFetch([
    [
      'api.genius.com/search',
      (url: string) => {
        calls.search++;
        const q = new URL(url).searchParams.get('q') ?? '';
        const hits = q.includes('Небо') ? [hit(42, 'Небо над крышами', 'Полярный Свет'), hit(43, 'Небо', 'Кто-то')] : [];
        return { meta: { status: 200 }, response: { hits: hits.map((result) => ({ type: 'song', result })) } };
      },
    ],
    [
      'api.genius.com/songs/',
      (url: string) => {
        calls.song++;
        const id = Number(new URL(url).pathname.split('/').pop());
        return { meta: { status: 200 }, response: { song: song(id, id === 42 ? 'Небо над крышами' : 'Другая', 'Полярный Свет') } };
      },
    ],
  ]);
  const provider = new FakeProvider();
  const t = createTestApp([provider], impl, 'genius-token');
  after(t.cleanup);
  let owner: Awaited<ReturnType<typeof register>>;
  let other: Awaited<ReturnType<typeof register>>;
  let uploadId: number;
  let externalId: number;

  before(async () => {
    owner = await register(t.request, 'owner');
    other = await register(t.request, 'listener');
    const up = await t.request
      .post('/api/tracks')
      .set(owner.auth)
      .field('title', 'Небо над крышами (feat. Гость)')
      .field('artist', 'Полярный Свет')
      .attach('audio', sineWav(), { filename: 'a.wav', contentType: 'audio/wav' })
      .expect(201);
    uploadId = up.body.id;
    t.ctx.sync.storeTracks([track('ext', { title: 'Безымянная', artist: 'Никто' })], 'deezer', null);
    externalId = (t.ctx.db.prepare(`SELECT id FROM tracks WHERE external_id = 'ext'`).get() as { id: number }).id;
  });

  it('matches a track automatically and caches the song', async () => {
    const res = await t.request.get(`/api/tracks/${uploadId}/genius`).expect(200);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.manual, false);
    assert.equal(res.body.canEdit, false, 'guests cannot relink');
    assert.equal(res.body.song.id, 42);
    assert.deepEqual(res.body.song.writers.map((p: { name: string }) => p.name), ['Автор Слов', 'Автор Музыки']);

    await t.request.get(`/api/tracks/${uploadId}/genius`).expect(200);
    assert.deepEqual(calls, { search: 1, song: 1 });
  });

  it('remembers when nothing was found', async () => {
    const first = await t.request.get(`/api/tracks/${externalId}/genius`).expect(200);
    assert.equal(first.body.song, null);
    await t.request.get(`/api/tracks/${externalId}/genius`).expect(200);
    assert.equal(calls.search, 2, 'no second search within the retry window');
  });

  it('lets the author relink uploads and anyone relink service tracks', async () => {
    await t.request.put(`/api/tracks/${uploadId}/genius`).set(other.auth).send({ geniusId: 43 }).expect(403);
    const linked = await t.request.put(`/api/tracks/${externalId}/genius`).set(other.auth).send({ geniusId: 43 }).expect(200);
    assert.equal(linked.body.song.id, 43);
    assert.equal(linked.body.manual, true);

    const cleared = await t.request.put(`/api/tracks/${uploadId}/genius`).set(owner.auth).send({ geniusId: null }).expect(200);
    assert.equal(cleared.body.song, null);
    const after = await t.request.get(`/api/tracks/${uploadId}/genius`).set(owner.auth).expect(200);
    assert.equal(after.body.song, null, 'a manual "no song" is not re-matched');
    assert.equal(after.body.canEdit, true);
  });

  it('searches Genius for signed-in users', async () => {
    await t.request.get('/api/genius/search').query({ q: 'Небо' }).expect(401);
    const res = await t.request.get('/api/genius/search').query({ q: 'Небо' }).set(other.auth).expect(200);
    assert.deepEqual(
      res.body.map((s: { id: number; artist: string }) => [s.id, s.artist]),
      [
        [42, 'Полярный Свет'],
        [43, 'Кто-то'],
      ],
    );
  });

  it('reports when Genius is not configured', async () => {
    const plain = createTestApp();
    try {
      const user = await register(plain.request, 'someone');
      plain.ctx.sync.storeTracks([track('x')], 'deezer', null);
      const res = await plain.request.get('/api/tracks/1/genius').expect(200);
      assert.deepEqual(res.body, { configured: false, song: null, manual: false, canEdit: false });
      await plain.request.get('/api/genius/search').query({ q: 'x' }).set(user.auth).expect(400);
    } finally {
      plain.cleanup();
    }
  });
});
