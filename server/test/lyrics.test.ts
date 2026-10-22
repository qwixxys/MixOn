import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { LrclibClient, parseLrc, type LrclibRecord } from '../src/lyrics/lrclib.js';
import { pickRecord } from '../src/lyrics/service.js';
import { createTestApp, fakeFetch, register, sineWav } from './helpers.js';

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
        return new Response('{"code":404,"name":"TrackNotFound"}', { status: 404 });
      },
    ],
    [
      'lrclib.test/api/search',
      (url: string) => {
        calls.push(url);
        const q = new URL(url).searchParams;
        if (q.get('track_name') === 'Только текст') return [record(41, { trackName: 'Только текст', duration: 2 })];
        return q.get('track_name') === 'Через поиск' ? [record(20, { trackName: 'Через поиск', duration: 2 })] : [];
      },
    ],
  ]);
  const t = createTestApp(undefined, impl, null, 'https://lrclib.test');
  after(t.cleanup);
  const ids: Record<string, number> = {};

  before(async () => {
    const user = await register(t.request, 'singer');
    for (const title of ['Тестовая песня', 'Через поиск', 'Нигде нет', 'С альбомом', 'Только текст']) {
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

  it('prefers a synced version found by search over a plain exact match', async () => {
    const res = await t.request.get(`/api/tracks/${ids['Только текст']}/lyrics`).expect(200);
    assert.ok(res.body.synced?.length, 'synced lines from the search hit');
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
