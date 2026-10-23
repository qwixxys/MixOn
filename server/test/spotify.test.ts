import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { parseEmbed, spotifyLink } from '../src/lib/spotify.js';
import type { ExternalTrack, MusicProvider, ProviderId } from '../src/providers/index.js';
import { createTestApp, fakeFetch, register, track } from './helpers.js';

const embed = (entity: object) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></body></html>`;

const PLAYLIST = embed({
  type: 'playlist',
  name: 'Мой плейлист',
  trackList: [
    { uri: 'spotify:track:1', title: 'Song One', subtitle: 'Band', duration: 200_000 },
    { uri: 'spotify:track:2', title: 'Song Two', subtitle: 'Band, Guest', duration: 180_000 },
    { uri: 'spotify:track:3', title: 'Missing', subtitle: 'Nobody', duration: 100_000 },
  ],
});

/** A service that finds the given songs by words of the query. */
function service(id: ProviderId, fullTracks: boolean, songs: ExternalTrack[]): MusicProvider {
  return {
    id,
    name: id,
    description: '',
    requiresToken: false,
    connectMode: null,
    fullTracks,
    proxyStreams: false,
    isConfigured: () => true,
    searchArtists: async () => [],
    getArtistTracks: async () => [],
    resolveStream: async () => null,
    searchTracks: async (q) => songs.filter((s) => q.toLowerCase().includes(s.title.toLowerCase())),
  };
}

describe('Spotify playlists', () => {
  it('understands Spotify links', () => {
    assert.deepEqual(spotifyLink(new URL('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')), {
      kind: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
    });
    assert.deepEqual(spotifyLink(new URL('https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy')), {
      kind: 'album',
      id: '4aawyAB9vmqN3uQ7FjRGTy',
    });
    assert.equal(spotifyLink(new URL('https://open.spotify.com/track/4aawyAB9vmqN3uQ7FjRGTy')), null);
    assert.equal(spotifyLink(new URL('https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M')), null);
  });

  it('reads the track list from the embed page', () => {
    const list = parseEmbed(PLAYLIST);
    assert.equal(list.title, 'Мой плейлист');
    assert.deepEqual(list.tracks[1], { title: 'Song Two', artist: 'Band, Guest', duration: 180 });
    assert.throws(() => parseEmbed('<html>nothing</html>'), /не отдал список треков/);
  });

  describe('import', () => {
    const { impl, calls } = fakeFetch([
      ['open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M', () => new Response(PLAYLIST, { headers: { 'content-type': 'text/html' } })],
    ]);
    const full = service('vk', true, [track('vk1', { title: 'Song One', artist: 'Band', duration: 201 })]);
    const previews = service('deezer', false, [
      track('dz1', { title: 'Song One', artist: 'Band', duration: 200, isPreview: true }),
      track('dz2', { title: 'Song Two', artist: 'Band', duration: 181, isPreview: true }),
    ]);
    const t = createTestApp([previews, full], impl);
    after(t.cleanup);

    it('finds each song on the services, full tracks first, and tops the playlist up on a second import', async () => {
      const user = await register(t.request, 'listener');
      const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x';
      const res = await t.request.post('/api/import').set(user.auth).send({ url }).expect(201);
      assert.deepEqual(
        [res.body.title, res.body.imported, res.body.missing, res.body.previews],
        ['Мой плейлист', 2, 1, 1],
      );
      const playlist = await t.request.get(`/api/playlists/${res.body.playlistId}`).set(user.auth).expect(200);
      assert.deepEqual(
        playlist.body.tracks.map((tr: { title: string; source: string }) => [tr.title, tr.source]),
        [
          ['Song One', 'vk'],
          ['Song Two', 'deezer'],
        ],
      );
      assert.ok(calls.some((c) => (c.init?.headers as Record<string, string>)['user-agent']?.includes('Mozilla')));
      const again = await t.request.post('/api/import').set(user.auth).send({ url }).expect(201);
      assert.equal(again.body.playlistId, res.body.playlistId);
    });
  });
});
