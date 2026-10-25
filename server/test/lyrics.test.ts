import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { LrclibClient, parseLrc, type LrclibRecord } from '../src/lyrics/lrclib.js';
import { pickRecord } from '../src/lyrics/service.js';
import { songQuery } from '../src/lib/matching.js';
import { createTestApp, fakeFetch, register, sineWav, track } from './helpers.js';

// Placeholder text only: these tests never contain real song lyrics.
const record = (id: number, overrides: Partial<LrclibRecord> = {}): LrclibRecord => ({
  id,
  trackName: 'Тестовая песня',
  artistName: 'Тестовый Артист',
  albumName: 'Тестовый альбом',
  duration: 180,
  instrumental: false,
  plainLyrics: 'строка один\nстрока два',
  syncedLyrics: '[00:01.00] строка один\n[00:03.50] строка два',
  ...overrides,
});

describe('parseLrc', () => {
  it('parses timestamps, repeated stamps, offsets and enhanced word tags', () => {
    const lines = parseLrc(
      ['[ar:Тестовый Артист]', '[offset:+500]', '[00:10.00][00:30.25]припев-заглушка', '[00:05.5] <00:05.50>слово <00:06.00>заглушка', 'не строка', '[01:02.003] третья'].join('\n'),
    );
    assert.deepEqual(lines, [
      { time: 5, text: 'слово заглушка' },
      { time: 9.5, text: 'припев-заглушка' },
      { time: 29.75, text: 'припев-заглушка' },
      { time: 61.503, text: 'третья' },
    ]);
  });

  it('uses only the timestamps at the start of a line', () => {
    assert.deepEqual(parseLrc('[00:10.00]Встреча в [12:30] у входа\n[00:12.00]Слово [00:12.50]за словом'), [
      { time: 10, text: 'Встреча в [12:30] у входа' },
      { time: 12, text: 'Слово за словом' },
    ]);
  });

  it('bounds what one odd record can produce', () => {
    const lines = parseLrc(`${'[0:0]'.repeat(5000)}${'а'.repeat(5000)}`);
    assert.equal(lines.length, 10);
    assert.equal(lines[0].text.length, 1000);
    assert.equal(parseLrc(Array.from({ length: 5000 }, (_, i) => `[00:${String(i % 60).padStart(2, '0')}.00]x`).join('\n')).length, 3000);
  });

  it('keeps empty lines as pauses', () => {
    assert.deepEqual(parseLrc('[00:01.00] а\n[00:02.00]\n'), [
      { time: 1, text: 'а' },
      { time: 2, text: '' },
    ]);
  });
});

describe('pickRecord', () => {
  const track = { title: 'Тестовая песня (feat. Гость)', artist: 'Тестовый Артист feat. Гость', duration: 181 };

  it('prefers matching synced lyrics within the duration tolerance', () => {
    const picked = pickRecord(
      [
        record(1, { syncedLyrics: null }),
        record(2, { duration: 200 }),
        record(3, { artistName: 'Совсем Другой' }),
        record(4),
      ],
      track,
    );
    assert.equal(picked?.id, 4);
  });

  it('splits "Artist - Song" upload titles', () => {
    assert.deepEqual(songQuery({ title: 'Тестовый Артист - Тестовая песня', artist: 'какой-то аккаунт' }), {
      title: 'Тестовая песня',
      artist: 'Тестовый Артист',
    });
    assert.deepEqual(songQuery({ title: 'Тестовый Артист - Тестовая песня', artist: 'Тестовый Артист' }), {
      title: 'Тестовая песня',
      artist: 'Тестовый Артист',
    });
  });

  it('returns null when nothing matches', () => {
    assert.equal(pickRecord([record(1, { trackName: 'Другая' })], track), null);
  });
});

describe('LRCLIB client', () => {
  it('identifies itself, skips durations LRCLIB rejects and treats empty records as missing', async () => {
    const { impl, calls } = fakeFetch([['lrclib.test/api/get', record(1, { plainLyrics: null, syncedLyrics: null })]]);
    const client = new LrclibClient('https://lrclib.test', 'soundFy v0.1.0 (https://example.test)', impl, 0);
    assert.equal(await client.get({ artist: 'a', title: 'b', album: null, duration: 7200 }), null);
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.has('duration'), false);
    assert.equal((calls[0].init?.headers as Record<string, string>)['lrclib-client'], 'soundFy v0.1.0 (https://example.test)');
  });
});

describe('lyrics API', () => {
  const calls: string[] = [];
  const { impl } = fakeFetch([
    [
      'lrclib.test/api/get',
      (url: string) => {
        calls.push(url);
        const q = new URL(url).searchParams;
        if (q.get('track_name') === 'Тестовая песня') return record(10, { duration: 2 });
        if (q.get('track_name') === 'С альбомом' && !q.has('album_name')) return record(30, { trackName: 'С альбомом', duration: 2 });
        if (q.get('track_name') === 'Только текст') return record(40, { trackName: 'Только текст', duration: 2, syncedLyrics: null });
        if (q.get('track_name') === 'Поиск сломан') return record(50, { trackName: 'Поиск сломан', duration: 2, syncedLyrics: null });
        return new Response('{"code":404,"name":"TrackNotFound"}', { status: 404 });
      },
    ],
    [
      'lrclib.test/api/search',
      (url: string) => {
        calls.push(url);
        const q = new URL(url).searchParams;
        if (q.get('track_name') === 'Только текст') return [record(41, { trackName: 'Только текст', duration: 2 })];
        if (q.get('track_name') === 'Поиск сломан') return new Response('{"name":"ServerOverloaded"}', { status: 503 });
        return q.get('track_name') === 'Через поиск' ? [record(20, { trackName: 'Через поиск', duration: 2 })] : [];
      },
    ],
  ]);
  const t = createTestApp(undefined, impl, null, 'https://lrclib.test');
  after(t.cleanup);
  const ids: Record<string, number> = {};

  before(async () => {
    const user = await register(t.request, 'singer');
    for (const title of ['Тестовая песня', 'Через поиск', 'Нигде нет', 'С альбомом', 'Только текст', 'Поиск сломан', 'Тестовая песня [Green Version]']) {
      const res = await t.request
        .post('/api/tracks')
        .set(user.auth)
        .field('title', title)
        .field('artist', 'Тестовый Артист')
        .attach('audio', sineWav(2), { filename: 'a.wav', contentType: 'audio/wav' })
        .expect(201);
      ids[title] = res.body.id;
    }
  });

  it('returns synced lines from an exact match and caches them', async () => {
    const res = await t.request.get(`/api/tracks/${ids['Тестовая песня']}/lyrics`).expect(200);
    assert.equal(res.body.found, true);
    assert.equal(res.body.source, 'lrclib');
    assert.deepEqual(res.body.synced, [
      { time: 1, text: 'строка один' },
      { time: 3.5, text: 'строка два' },
    ]);
    const before = calls.length;
    await t.request.get(`/api/tracks/${ids['Тестовая песня']}/lyrics`).expect(200);
    assert.equal(calls.length, before, 'served from cache');
    assert.equal(new URL(calls[0]).searchParams.get('duration'), '2');
  });

  it('falls back to search when the exact lookup misses', async () => {
    const res = await t.request.get(`/api/tracks/${ids['Через поиск']}/lyrics`).expect(200);
    assert.equal(res.body.found, true);
    assert.ok(calls.some((u) => u.includes('/api/search')));
  });

  it('retries without an album that LRCLIB does not know', async () => {
    t.ctx.db.prepare('UPDATE tracks SET album = ? WHERE id = ?').run('Другой альбом', ids['С альбомом']);
    const res = await t.request.get(`/api/tracks/${ids['С альбомом']}/lyrics`).expect(200);
    assert.equal(res.body.found, true);
    const lookups = calls.filter((u) => u.includes('/api/get') && u.includes(encodeURIComponent('С альбомом').replace(/%20/g, '+')));
    assert.equal(lookups.length, 2);
  });

  it('tries the bare title when a bracketed one finds nothing', async () => {
    const res = await t.request.get(`/api/tracks/${ids['Тестовая песня [Green Version]']}/lyrics`).expect(200);
    assert.equal(res.body.found, true);
  });

  it('reads YouTube video titles as "Artist - Song"', async () => {
    // A channel that is not the artist uploaded it; the title names both.
    const { ids: [id] } = t.ctx.sync.storeTracks(
      [track('ytvideo0009', { title: 'Тестовый Артист - Через поиск', artist: 'Какой-то канал', duration: 2 })],
      'youtube',
      null,
    );
    const res = await t.request.get(`/api/tracks/${id}/lyrics`).expect(200);
    assert.equal(res.body.found, true);
  });

  it('prefers a synced version found by search over a plain exact match', async () => {
    const res = await t.request.get(`/api/tracks/${ids['Только текст']}/lyrics`).expect(200);
    assert.ok(res.body.synced?.length, 'synced lines from the search hit');
  });

  it('keeps plain lyrics when the extra search fails', async () => {
    const res = await t.request.get(`/api/tracks/${ids['Поиск сломан']}/lyrics`).expect(200);
    assert.equal(res.body.found, true);
    assert.equal(res.body.synced, null);
    assert.ok(res.body.plain);
  });

  it('forgets cached lyrics when the author renames the track', async () => {
    const owner = await t.request.post('/api/auth/login').send({ login: 'singer', password: 'secret123' });
    const auth = { Authorization: `Bearer ${owner.body.token}` };
    await t.request.get(`/api/tracks/${ids['Тестовая песня']}/lyrics`).expect(200);
    const count = () => (t.ctx.db.prepare('SELECT COUNT(*) AS c FROM lyrics_cache WHERE track_id = ?').get(ids['Тестовая песня']) as { c: number }).c;
    assert.equal(count(), 1);
    await t.request.patch(`/api/tracks/${ids['Тестовая песня']}`).set(auth).field('description', 'новое описание').expect(200);
    assert.equal(count(), 1, 'other edits keep the cache');
    await t.request.patch(`/api/tracks/${ids['Тестовая песня']}`).set(auth).field('title', 'Новое название').expect(200);
    assert.equal(count(), 0);
  });

  it('remembers misses', async () => {
    const first = await t.request.get(`/api/tracks/${ids['Нигде нет']}/lyrics`).expect(200);
    assert.deepEqual(first.body, { enabled: true, found: false, source: null, instrumental: false, synced: null, plain: null });
    const before = calls.length;
    await t.request.get(`/api/tracks/${ids['Нигде нет']}/lyrics`).expect(200);
    assert.equal(calls.length, before);
  });

  it('reports when lyrics are turned off', async () => {
    const off = createTestApp();
    try {
      const user = await register(off.request, 'quiet');
      const up = await off.request
        .post('/api/tracks')
        .set(user.auth)
        .field('title', 'x')
        .attach('audio', sineWav(), { filename: 'a.wav', contentType: 'audio/wav' })
        .expect(201);
      const res = await off.request.get(`/api/tracks/${up.body.id}/lyrics`).expect(200);
      assert.equal(res.body.enabled, false);
    } finally {
      off.cleanup();
    }
  });
});
