import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { expandLink } from '../src/lib/links.js';
import { DeezerProvider } from '../src/providers/deezer.js';
import { SoundCloudProvider, type ScTrack } from '../src/providers/soundcloud.js';
import { createTestApp, fakeFetch, register } from './helpers.js';

const dzTrack = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Песня ${id}`,
  duration: 200,
  preview: `https://cdnt-preview.dzcdn.net/${id}.mp3`,
  link: `https://www.deezer.com/track/${id}`,
  artist: { id: 1, name: 'Исполнитель' },
  album: { id: 9, title: 'Альбом', cover_big: 'https://cdn/9.jpg' },
  ...overrides,
});

/** A Deezer playlist of `count` tracks served in pages, like /playlist/{id}/tracks?index=&limit=. */
function deezerPlaylist(count: number) {
  return fakeFetch([
    ['api.deezer.com/playlist/77/tracks', (url: string) => {
      const q = new URL(url).searchParams;
      const index = Number(q.get('index'));
      const limit = Number(q.get('limit'));
      const ids = Array.from({ length: Math.max(0, Math.min(limit, count - index)) }, (_, i) => index + i + 1);
      return { data: ids.map((id) => dzTrack(id, id === 2 ? { readable: false } : {})), total: count };
    }],
    ['api.deezer.com/playlist/77', { id: 77, title: 'Подборка', description: 'Описание подборки', nb_tracks: count }],
  ]);
}

describe('link expansion', () => {
  it('normalises links and follows short links only on allowed hosts', async () => {
    const { impl, calls } = fakeFetch([
      ['link.deezer.com/s/abc', () => new Response(null, { status: 302, headers: { location: 'https://www.deezer.com/ru/playlist/77?utm=x' } })],
    ]);
    const url = await expandLink('link.deezer.com/s/abc#x', ['link.deezer.com'], impl);
    assert.equal(url.toString(), 'https://www.deezer.com/ru/playlist/77?utm=x');
    assert.equal(calls[0].init?.redirect, 'manual');

    const direct = await expandLink('http://www.deezer.com/album/5', ['link.deezer.com'], impl);
    assert.equal(direct.toString(), 'https://www.deezer.com/album/5');
    assert.equal(calls.length, 1, 'ordinary links are never fetched');
  });

  it('stops at a redirect to a host that is not allowed', async () => {
    const { impl, calls } = fakeFetch([
      ['on.soundcloud.com/x', () => new Response(null, { status: 301, headers: { location: 'http://127.0.0.1:8080/admin' } })],
    ]);
    const url = await expandLink('https://on.soundcloud.com/x', ['on.soundcloud.com'], impl);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(calls.length, 1);
  });

  it('rejects non-links and other schemes', async () => {
    await assert.rejects(expandLink('просто текст', [], fetch), /ссылк/);
    await assert.rejects(expandLink('ftp://deezer.com/playlist/1', [], fetch), /http/);
    await assert.rejects(expandLink('javascript:alert(1)', [], fetch), /http/);
  });

  it('reports dead short links', async () => {
    const { impl } = fakeFetch([['link.deezer.com', { ok: true }]]);
    await assert.rejects(expandLink('https://link.deezer.com/s/dead', ['link.deezer.com'], impl), /никуда не ведёт/);
  });
});

describe('Deezer import', () => {
  const deezer = new DeezerProvider();

  it('recognises playlist and album links', () => {
    assert.equal(deezer.canImport(new URL('https://www.deezer.com/ru/playlist/77')), true);
    assert.equal(deezer.canImport(new URL('https://www.deezer.com/en-gb/album/5')), true);
    assert.equal(deezer.canImport(new URL('https://deezer.com/playlist/77')), true);
    assert.equal(deezer.canImport(new URL('https://www.deezer.com/artist/27')), false);
    assert.equal(deezer.canImport(new URL('https://evil.example/www.deezer.com/playlist/1')), false);
    assert.equal(deezer.canImport(new URL('https://deezer.com.evil.example/playlist/1')), false);
  });

  it('pages through a playlist and skips unplayable tracks', async () => {
    const { impl, calls } = deezerPlaylist(150);
    const playlist = await new DeezerProvider(impl).importPlaylist(new URL('https://www.deezer.com/ru/playlist/77'));
    assert.equal(playlist.title, 'Подборка');
    assert.equal(playlist.total, 150);
    assert.equal(playlist.tracks.length, 149);
    assert.equal(playlist.tracks[0].album, 'Альбом');
    assert.deepEqual(
      calls.map((c) => c.url),
      [
        'https://api.deezer.com/playlist/77',
        'https://api.deezer.com/playlist/77/tracks?index=0&limit=100',
        'https://api.deezer.com/playlist/77/tracks?index=100&limit=100',
      ],
    );
  });

  it('reads albums with their own cover and release date', async () => {
    const { impl } = fakeFetch([
      [
        'api.deezer.com/album/5',
        {
          id: 5,
          title: 'Пластинка',
          cover_big: 'https://cdn/5.jpg',
          release_date: '2026-09-01',
          genre_id: 152,
          nb_tracks: 2,
          tracks: { data: [dzTrack(1, { album: undefined }), dzTrack(2, { album: undefined })] },
        },
      ],
    ]);
    const album = await new DeezerProvider(impl).importPlaylist(new URL('https://www.deezer.com/album/5'));
    assert.equal(album.title, 'Пластинка');
    assert.equal(album.tracks[0].coverUrl, 'https://cdn/5.jpg');
    assert.equal(album.tracks[0].releasedAt, '2026-09-01T00:00:00.000Z');
    assert.equal(album.tracks[0].genre, 'Rock');
  });
});

describe('SoundCloud import', () => {
  const scTrack = (id: number, overrides: Partial<ScTrack> = {}): ScTrack => ({
    id,
    urn: `soundcloud:tracks:${id}`,
    title: `Трек ${id}`,
    user: { id: 7, urn: 'soundcloud:users:7', username: 'producer' },
    duration: 185_000,
    permalink_url: `https://soundcloud.com/producer/track-${id}`,
    created_at: '2026/10/01 10:00:00 +0000',
    streamable: true,
    access: 'playable',
    ...overrides,
  });

  it('recognises playlist links', () => {
    const sc = new SoundCloudProvider({ clientId: 'cid', clientSecret: 'secret' });
    assert.equal(sc.canImport(new URL('https://soundcloud.com/producer/sets/mix')), true);
    assert.equal(sc.canImport(new URL('https://m.soundcloud.com/producer/sets/mix/')), true);
    assert.equal(sc.canImport(new URL('https://soundcloud.com/producer/track-1')), false);
    assert.equal(sc.canImport(new URL('https://soundcloud.com.evil.example/producer/sets/mix')), false);
  });

  it('resolves the playlist and reads its tracks', async () => {
    const { impl, calls } = fakeFetch([
      ['/oauth/token', { access_token: 'app', expires_in: 3600 }],
      ['/resolve', { kind: 'playlist', id: 55, urn: 'soundcloud:playlists:55', title: 'Ночной сет', description: '', track_count: 3 }],
      [
        '/playlists/',
        { collection: [scTrack(1), scTrack(2, { access: 'blocked' }), scTrack(3, { access: 'preview' })], next_href: null },
      ],
    ]);
    const playlist = await new SoundCloudProvider({ clientId: 'cid', clientSecret: 'secret' }, impl).importPlaylist(
      new URL('https://m.soundcloud.com/producer/sets/night?si=abc'),
    );
    assert.match(calls[1].url, /\/resolve\?url=https%3A%2F%2Fsoundcloud\.com%2Fproducer%2Fsets%2Fnight$/);
    assert.match(calls[2].url, /\/playlists\/soundcloud%3Aplaylists%3A55\/tracks\?/);
    assert.equal(playlist.title, 'Ночной сет');
    assert.equal(playlist.description, null);
    assert.deepEqual(
      playlist.tracks.map((t) => [t.externalId, t.isPreview]),
      [
        ['soundcloud:tracks:1', false],
        ['soundcloud:tracks:3', true],
      ],
    );
  });
});

describe('import API', () => {
  const { impl } = deezerPlaylist(3);
  const short = fakeFetch([
    ['link.deezer.com/s/short', () => new Response(null, { status: 302, headers: { location: 'https://www.deezer.com/playlist/77' } })],
  ]);
  const fetchImpl: typeof impl = (url, init) => (url.includes('link.deezer.com') ? short.impl(url, init) : impl(url, init));
  const t = createTestApp([new DeezerProvider(fetchImpl), new SoundCloudProvider({ clientId: null, clientSecret: null }, fetchImpl)], fetchImpl);
  after(t.cleanup);
  let auth: Record<string, string>;

  before(async () => {
    auth = (await register(t.request, 'importer')).auth;
  });

  it('needs a login', async () => {
    await t.request.post('/api/import').send({ url: 'https://www.deezer.com/playlist/77' }).expect(401);
  });

  it('imports a playlist into a private playlist and tops it up on re-import', async () => {
    const first = await t.request.post('/api/import').set(auth).send({ url: 'https://www.deezer.com/ru/playlist/77' }).expect(201);
    assert.equal(first.body.title, 'Подборка');
    assert.equal(first.body.imported, 2);
    assert.equal(first.body.total, 3);
    assert.equal(first.body.newTracks, 2);

    const again = await t.request.post('/api/import').set(auth).send({ url: 'link.deezer.com/s/short' }).expect(201);
    assert.equal(again.body.playlistId, first.body.playlistId);
    assert.equal(again.body.newTracks, 0);

    const playlist = await t.request.get(`/api/playlists/${first.body.playlistId}`).set(auth).expect(200);
    assert.equal(playlist.body.isPublic, false);
    assert.equal(playlist.body.tracks.length, 2);
    assert.match(playlist.body.description, /^Описание подборки\n\nИмпортировано из Deezer: https:\/\/www\.deezer\.com\/playlist\/77$/);
  });

  it('explains unsupported and unconfigured links', async () => {
    const other = await t.request.post('/api/import').set(auth).send({ url: 'https://example.com/playlist/1' }).expect(400);
    assert.match(other.body.error, /не поддерживаются/);
    const sc = await t.request.post('/api/import').set(auth).send({ url: 'https://soundcloud.com/a/sets/b' }).expect(400);
    assert.match(sc.body.error, /SoundCloud не настроен/);
  });

  it('lists which services import links', async () => {
    const res = await t.request.get('/api/services').set(auth).expect(200);
    const byId = Object.fromEntries(res.body.map((s: { id: string; importsLinks: boolean }) => [s.id, s.importsLinks]));
    assert.deepEqual(byId, { deezer: true, soundcloud: false });
  });
});
