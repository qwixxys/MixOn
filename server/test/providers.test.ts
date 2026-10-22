import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderError } from '../src/lib/http.js';
import { DeezerProvider } from '../src/providers/deezer.js';
import { ItunesProvider } from '../src/providers/itunes.js';
import { JamendoProvider } from '../src/providers/jamendo.js';
import { VkProvider, type VkAudio } from '../src/providers/vk.js';
import { fakeFetch } from './helpers.js';

describe('Deezer', () => {
  it('searches artists', async () => {
    const { impl, calls } = fakeFetch([
      [
        '/search/artist',
        {
          data: [
            { id: 27, name: 'Daft Punk', link: 'https://www.deezer.com/artist/27', picture_big: 'big.jpg', nb_fan: 4_512_000 },
          ],
        },
      ],
    ]);
    const artists = await new DeezerProvider(impl).searchArtists('daft punk');
    assert.equal(calls[0].url, 'https://api.deezer.com/search/artist?q=daft%20punk&limit=20');
    assert.deepEqual(artists, [
      {
        externalId: '27',
        name: 'Daft Punk',
        imageUrl: 'big.jpg',
        url: 'https://www.deezer.com/artist/27',
        subtitle: '4.5M подписчиков',
      },
    ]);
  });

  it('collects tracks from the newest releases first', async () => {
    const { impl, calls } = fakeFetch([
      [
        '/artist/27/albums',
        {
          data: [
            { id: 1, title: 'Old', release_date: '2001-03-12', cover_big: 'old.jpg' },
            { id: 2, title: 'New Single', release_date: '2026-10-01', cover_big: 'new.jpg' },
          ],
        },
      ],
      [
        '/album/2/tracks',
        {
          data: [
            { id: 200, title: 'Fresh', duration: 201, preview: 'https://cdn/200.mp3', link: 'l', artist: { id: 27, name: 'Daft Punk' } },
            { id: 201, title: 'Blocked', duration: 100, preview: '', link: 'l', artist: { id: 27, name: 'Daft Punk' }, readable: false },
          ],
        },
      ],
      ['/album/1/tracks', { data: [{ id: 100, title: 'One More Time', duration: 320, preview: 'https://cdn/100.mp3', link: 'l', artist: { id: 27, name: 'Daft Punk' } }] }],
    ]);
    const tracks = await new DeezerProvider(impl).getArtistTracks({ externalId: '27', name: 'Daft Punk' });
    assert.deepEqual(
      tracks.map((t) => [t.externalId, t.album, t.releasedAt, t.isPreview]),
      [
        ['200', 'New Single', '2026-10-01T00:00:00.000Z', true],
        ['100', 'Old', '2001-03-12T00:00:00.000Z', true],
      ],
    );
    assert.ok(calls[1].url.includes('/album/2/tracks'), 'newest album is fetched first');
  });

  it('surfaces API errors returned with HTTP 200', async () => {
    const { impl } = fakeFetch([['/track/', { error: { type: 'DataException', message: 'no data', code: 800 } }]]);
    await assert.rejects(
      new DeezerProvider(impl).resolveStream({ externalId: '1', streamUrl: null, extra: null }),
      (err: unknown) => err instanceof ProviderError && /no data/.test(err.message),
    );
  });
});

describe('iTunes', () => {
  it('maps songs and upscales artwork', async () => {
    const { impl, calls } = fakeFetch([
      [
        '/lookup',
        {
          resultCount: 3,
          results: [
            { wrapperType: 'artist', artistId: 5, artistName: 'Artist' },
            {
              wrapperType: 'track',
              kind: 'song',
              trackId: 11,
              trackName: 'Older',
              artistName: 'Artist',
              previewUrl: 'https://audio/11.m4a',
              artworkUrl100: 'https://img/100x100bb.jpg',
              releaseDate: '2020-01-01T08:00:00Z',
              trackTimeMillis: 200000,
            },
            {
              wrapperType: 'track',
              kind: 'song',
              trackId: 12,
              trackName: 'Newer',
              artistName: 'Artist',
              collectionName: 'LP',
              previewUrl: 'https://audio/12.m4a',
              artworkUrl100: 'https://img/100x100bb.jpg',
              releaseDate: '2026-09-01T07:00:00Z',
              primaryGenreName: 'Pop',
            },
          ],
        },
      ],
    ]);
    const tracks = await new ItunesProvider('RU', impl).getArtistTracks({ externalId: '5', name: 'Artist' });
    assert.match(calls[0].url, /lookup\?id=5&entity=song&limit=50&sort=recent&country=RU/);
    assert.deepEqual(
      tracks.map((t) => [t.externalId, t.title, t.genre]),
      [
        ['12', 'Newer', 'Pop'],
        ['11', 'Older', null],
      ],
    );
    assert.equal(tracks[0].coverUrl, 'https://img/600x600bb.jpg');
    assert.equal(tracks[1].duration, 200);
  });
});

describe('Jamendo', () => {
  it('requires a client id', async () => {
    const provider = new JamendoProvider(null, fakeFetch([]).impl);
    assert.equal(provider.isConfigured(), false);
    await assert.rejects(provider.searchArtists('x'), /JAMENDO_CLIENT_ID/);
  });

  it('returns full tracks', async () => {
    const { impl, calls } = fakeFetch([
      [
        '/tracks/',
        {
          headers: { status: 'success', code: 0 },
          results: [
            {
              id: '99',
              name: 'Free Song',
              duration: 240,
              artist_name: 'Indie',
              album_name: 'EP',
              album_image: 'cover.jpg',
              audio: 'https://mp3/99',
              shareurl: 'https://jamendo/99',
              releasedate: '2026-08-15',
            },
          ],
        },
      ],
    ]);
    const [t] = await new JamendoProvider('cid', impl).getArtistTracks({ externalId: '7', name: 'Indie' });
    assert.match(calls[0].url, /client_id=cid/);
    assert.equal(t.isPreview, false);
    assert.equal(t.streamUrl, 'https://mp3/99');
    assert.equal(t.releasedAt, '2026-08-15T00:00:00.000Z');
  });

  it('reports API failures', async () => {
    const { impl } = fakeFetch([['/artists/', { headers: { status: 'failed', code: 5, error_message: 'bad client id' }, results: [] }]]);
    await assert.rejects(new JamendoProvider('cid', impl).searchArtists('x'), /bad client id/);
  });
});

describe('VK', () => {
  const audio = (id: number, overrides: Partial<VkAudio> = {}): VkAudio => ({
    id,
    owner_id: -2001,
    artist: 'Кино',
    title: `Песня ${id}`,
    duration: 200,
    url: `https://cs1.vkuseraudio.net/${id}.mp3`,
    date: 1_790_000_000 + id,
    access_key: `key${id}`,
    album: { title: 'Альбом', thumb: { photo_300: 'thumb300.jpg', photo_600: 'thumb600.jpg' } },
    ...overrides,
  });
  const options = { apiVersion: '5.131', userAgent: 'KateMobileAndroid/test' };
  const body = (init?: RequestInit) => new URLSearchParams(String(init?.body));

  it('needs a token', async () => {
    const provider = new VkProvider(options, fakeFetch([]).impl);
    await assert.rejects(provider.searchArtists('кино', {}), (err: unknown) => err instanceof ProviderError && err.code === 'no_token');
  });

  it('sends the token, API version and user agent', async () => {
    const { impl, calls } = fakeFetch([
      ['audio.searchArtists', { response: { count: 1, items: [{ id: '123', name: 'Кино', domain: 'kino', photo: [{ url: 'p.jpg', width: 300, height: 300 }] }] } }],
    ]);
    const [artist] = await new VkProvider(options, impl).searchArtists('кино', { token: 'user-token' });
    assert.deepEqual(artist, { externalId: '123', name: 'Кино', imageUrl: 'p.jpg', url: 'https://vk.com/artist/kino', subtitle: null });
    const params = body(calls[0].init);
    assert.equal(params.get('access_token'), 'user-token');
    assert.equal(params.get('v'), '5.131');
    assert.equal(params.get('q'), 'кино');
    assert.equal((calls[0].init?.headers as Record<string, string>)['user-agent'], 'KateMobileAndroid/test');
  });

  it('falls back to track search when artist search is unavailable', async () => {
    const { impl } = fakeFetch([
      ['audio.searchArtists', { error: { error_code: 3, error_msg: 'Unknown method passed' } }],
      [
        'audio.search',
        {
          response: {
            count: 2,
            items: [audio(1, { main_artists: [{ id: '555', name: 'Кино' }] }), audio(2, { artist: 'Кино feat. X' })],
          },
        },
      ],
    ]);
    const artists = await new VkProvider(options, impl).searchArtists('кино', { token: 't' });
    assert.deepEqual(
      artists.map((a) => a.externalId),
      ['555', 'name:Кино feat. X'],
    );
  });

  it('maps artist audios newest first and skips restricted ones', async () => {
    const { impl } = fakeFetch([
      [
        'audio.getAudiosByArtist',
        { response: { count: 3, items: [audio(1), audio(3, { genre_id: 1 }), audio(2, { content_restricted: 1 })] } },
      ],
    ]);
    const tracks = await new VkProvider(options, impl).getArtistTracks({ externalId: '555', name: 'Кино' }, { token: 't' });
    assert.deepEqual(
      tracks.map((t) => t.externalId),
      ['-2001_3', '-2001_1'],
    );
    assert.equal(tracks[0].genre, 'Rock');
    assert.equal(tracks[0].coverUrl, 'thumb600.jpg');
    assert.equal(tracks[0].externalUrl, 'https://vk.com/audio-2001_3');
    assert.deepEqual(tracks[0].extra, { accessKey: 'key3' });
    assert.equal(tracks[0].isPreview, false);
  });

  it('searches by name for name-based artist ids', async () => {
    const { impl, calls } = fakeFetch([
      ['audio.search', { response: { count: 2, items: [audio(1), audio(2, { artist: 'Другой' })] } }],
    ]);
    const tracks = await new VkProvider(options, impl).getArtistTracks({ externalId: 'name:Кино', name: 'Кино' }, { token: 't' });
    assert.equal(tracks.length, 1);
    assert.equal(body(calls[0].init).get('performer_only'), '1');
  });

  it('resolves fresh stream URLs with the access key', async () => {
    const { impl, calls } = fakeFetch([
      ['audio.getById', { response: [audio(7, { url: 'https://cs1.vkuseraudio.net/s/v1/ac/x/index.m3u8?extra=1' })] }],
    ]);
    const source = await new VkProvider(options, impl).resolveStream(
      { externalId: '-2001_7', streamUrl: null, extra: { accessKey: 'key7' } },
      { token: 't' },
    );
    assert.equal(body(calls[0].init).get('audios'), '-2001_7_key7');
    assert.equal(source?.kind, 'hls');
  });

  it('explains tokens without audio access', async () => {
    const { impl } = fakeFetch([
      ['users.get', { response: [{ id: 1, first_name: 'Иван', last_name: 'Петров' }] }],
      ['audio.get', { response: { count: 1, items: [audio(1, { url: 'https://vk.com/mp3/audio_api_unavailable.mp3' })] } }],
    ]);
    await assert.rejects(new VkProvider(options, impl).verifyToken('t'), /не даёт доступа к аудио/);
  });

  it('verifies a working token', async () => {
    const { impl } = fakeFetch([
      ['users.get', { response: [{ id: 1, first_name: 'Иван', last_name: 'Петров' }] }],
      ['audio.get', { response: { count: 1, items: [audio(1)] } }],
    ]);
    assert.deepEqual(await new VkProvider(options, impl).verifyToken('t'), { externalUserId: '1', displayName: 'Иван Петров' });
  });

  it('turns auth errors into readable messages', async () => {
    const { impl } = fakeFetch([['audio.get', { error: { error_code: 5, error_msg: 'User authorization failed' } }]]);
    await assert.rejects(new VkProvider(options, impl).getUserLibrary({ token: 't' }), /токен недействителен/);
  });
});
