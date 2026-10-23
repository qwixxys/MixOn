import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ExternalTrack, MusicProvider, SimilarSeed, StoredExternalTrack } from '../src/providers/types.js';
import { createTestApp, FakeProvider, register, track } from './helpers.js';

/** A service with an artist radio and a chart, like Deezer. */
class RadioService extends FakeProvider {
  seeds: SimilarSeed[] = [];
  async similarTracks(seed: SimilarSeed) {
    this.seeds.push(seed);
    return [
      ...Array.from({ length: 6 }, (_, i) => track(`sim-a${i}`, { title: `Похожая ${i}`, artist: 'Соседи' })),
      ...Array.from({ length: 6 }, (_, i) => track(`sim-b${i}`, { title: `Другая ${i}`, artist: 'Дальние' })),
      track('seed-song', { title: 'Своя', artist: seed.artist }),
    ];
  }
  async popularTracks() {
    return Array.from({ length: 8 }, (_, i) => track(`chart${i}`, { title: `Хит ${i}`, artist: `Звезда ${i}` }));
  }
}

describe('«Моя волна»', () => {
  const radio = new RadioService();
  const t = createTestApp([radio]);
  after(t.cleanup);
  let anna: Awaited<ReturnType<typeof register>>;
  const idOf = (externalId: string) => (t.ctx.db.prepare('SELECT id FROM tracks WHERE external_id = ?').get(externalId) as { id: number }).id;
  const artists = (tracks: { artist: string }[]) => tracks.map((x) => x.artist);

  before(async () => {
    anna = await register(t.request, 'anna');
    t.ctx.sync.storeTracks([track('fav', { title: 'Любимая', artist: 'Любимый Артист' })], 'deezer', null);
  });

  it('starts a newcomer from what is popular', async () => {
    const res = await t.request.get('/api/wave').set(anna.auth).expect(200);
    assert.equal(res.body.mode, 'mix');
    // The chart's eight songs and the one other song the app has.
    assert.equal(res.body.tracks.length, 9);
    assert.equal(res.body.tracks.filter((x: { title: string }) => x.title.startsWith('Хит')).length, 8, 'chart songs');
    await t.request.get('/api/wave').expect(401);
  });

  it('plays songs like the ones the listener likes, never twice in a queue', async () => {
    await t.request.post(`/api/tracks/${idOf('fav')}/like`).set(anna.auth).expect(200);
    radio.seeds = [];
    const first = await t.request.get('/api/wave?limit=8').set(anna.auth).expect(200);
    assert.ok(radio.seeds.some((s) => s.artist === 'Любимый Артист'), 'seeded with the liked artist');
    assert.equal(first.body.tracks.length, 8);
    // At most two songs of one artist in a batch.
    for (const name of new Set(artists(first.body.tracks))) assert.ok(artists(first.body.tracks).filter((a) => a === name).length <= 2, name);

    const ids = first.body.tracks.map((x: { id: number }) => x.id);
    const second = await t.request.get(`/api/wave?limit=8&exclude=${ids.join(',')}`).set(anna.auth).expect(200);
    for (const x of second.body.tracks) assert.ok(!ids.includes(x.id), `${x.title} repeated`);
  });

  it('keeps out what was turned down, and the artist after a second time', async () => {
    const a0 = idOf('sim-a0');
    await t.request.post('/api/wave/dislikes').set(anna.auth).send({ trackId: a0 }).expect(204);
    let res = await t.request.get('/api/wave?limit=20').set(anna.auth).expect(200);
    assert.ok(!res.body.tracks.some((x: { id: number }) => x.id === a0), 'the disliked song');
    await t.request.post('/api/wave/dislikes').set(anna.auth).send({ trackId: idOf('sim-a1') }).expect(204);
    res = await t.request.get('/api/wave?limit=20').set(anna.auth).expect(200);
    assert.ok(!artists(res.body.tracks).includes('Соседи'), 'the artist after two dislikes');
    await t.request.delete(`/api/wave/dislikes/${idOf('sim-a1')}`).set(anna.auth).expect(204);
    await t.request.post('/api/wave/dislikes').set(anna.auth).send({ trackId: 999999 }).expect(404);
  });

  it('«Незнакомое» leaves out the artists the listener knows', async () => {
    const res = await t.request.get('/api/wave?mode=discover&limit=20').set(anna.auth).expect(200);
    assert.equal(res.body.mode, 'discover');
    assert.ok(!artists(res.body.tracks).includes('Любимый Артист'));
    assert.ok(!res.body.tracks.some((x: { id: number }) => x.id === idOf('fav')));
  });

  it('recommends songs for the feed and keeps them for a while', async () => {
    const first = await t.request.get('/api/recommendations').set(anna.auth).expect(200);
    assert.ok(first.body.tracks.length > 0);
    const again = await t.request.get('/api/recommendations').set(anna.auth).expect(200);
    assert.deepEqual(again.body.tracks.map((x: { id: number }) => x.id), first.body.tracks.map((x: { id: number }) => x.id));
  });

  it('plays whole songs only: previews become full versions from another service, or drop out', async () => {
    /** Deezer-like: its radio has only 30-second previews. */
    class PreviewRadio extends FakeProvider {
      readonly fullTracks = false;
      async similarTracks() {
        return [
          ...Array.from({ length: 4 }, (_, i) => track(`pv-full${i}`, { title: `Целиком ${i}`, artist: `Певец ${i}`, isPreview: true })),
          ...Array.from({ length: 4 }, (_, i) => track(`pv-only${i}`, { title: `Только отрывок ${i}`, artist: `Певица ${i}`, isPreview: true })),
        ];
      }
    }
    /** SoundCloud-like: has the «Целиком» songs in full. */
    const fullService: MusicProvider = {
      id: 'soundcloud',
      name: 'Full',
      description: 'full',
      requiresToken: false,
      connectMode: null,
      fullTracks: true,
      proxyStreams: false,
      isConfigured: () => true,
      searchArtists: async () => [],
      getArtistTracks: async () => [],
      resolveStream: async (t: StoredExternalTrack) => ({ url: t.streamUrl ?? '', kind: 'direct' as const }),
      searchTracks: async (q: string): Promise<ExternalTrack[]> => {
        const n = q.match(/Целиком (\d)/)?.[1];
        return n ? [track(`sc-full${n}`, { title: `Целиком ${n}`, artist: `Певец ${n}` })] : [];
      },
    };
    const mixed = createTestApp([new PreviewRadio(), fullService]);
    try {
      const user = await register(mixed.request, 'wholesongs');
      mixed.ctx.sync.storeTracks([track('liked', { title: 'Своя', artist: 'Певец 0' })], 'soundcloud', null);
      const liked = (mixed.ctx.db.prepare(`SELECT id FROM tracks WHERE external_id = 'liked'`).get() as { id: number }).id;
      await mixed.request.post(`/api/tracks/${liked}/like`).set(user.auth).expect(200);
      const res = await mixed.request.get('/api/wave?mode=discover&limit=10').set(user.auth).expect(200);
      const titles = res.body.tracks.map((x: { title: string }) => x.title);
      assert.ok(res.body.tracks.length > 0);
      assert.ok(res.body.tracks.every((x: { isPreview: boolean }) => !x.isPreview), `no previews: ${titles.join(', ')}`);
      assert.ok(!titles.some((x: string) => x.startsWith('Только отрывок')), 'songs no service has in full stay out');
      assert.ok(res.body.tracks.filter((x: { source: string }) => x.source === 'soundcloud').length >= 3, 'full versions from the other service');
      const recs = await mixed.request.get('/api/recommendations').set(user.auth).expect(200);
      assert.ok(recs.body.tracks.every((x: { isPreview: boolean }) => !x.isPreview), 'recommendations too');
    } finally {
      mixed.cleanup();
    }
  });

  it('still answers when the services do not', async () => {
    const failing = new (class extends FakeProvider {
      async similarTracks(): Promise<never> {
        throw new Error('down');
      }
    })();
    const offline = createTestApp([failing]);
    try {
      const user = await register(offline.request, 'solo');
      offline.ctx.sync.storeTracks([track('x1', { title: 'Одна', artist: 'Кто-то' }), track('x2', { title: 'Две', artist: 'Другой' })], 'deezer', null);
      const res = await offline.request.get('/api/wave').set(user.auth).expect(200);
      assert.equal(res.body.tracks.length, 2);
    } finally {
      offline.cleanup();
    }
  });
});
