import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../src/db/index.js';
import { ProviderRegistry } from '../src/providers/index.js';
import { SyncService } from '../src/sync/syncService.js';
import { FakeProvider, track } from './helpers.js';

function setup() {
  const db = openDatabase(':memory:');
  const provider = new FakeProvider();
  const sync = new SyncService(db, new ProviderRegistry([provider]), { info() {}, warn() {}, error() {} });
  const user = (name: string) =>
    Number(
      db
        .prepare(`INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, 'x', ?)`)
        .run(name, `${name}@x`, name).lastInsertRowid,
    );
  const artist = Number(
    db.prepare(`INSERT INTO external_artists (provider, external_id, name) VALUES ('deezer', 'a1', 'Artist')`).run()
      .lastInsertRowid,
  );
  const subscribe = (userId: number) =>
    db.prepare('INSERT INTO subscriptions (user_id, external_artist_id) VALUES (?, ?)').run(userId, artist);
  const notifications = (userId: number) =>
    db.prepare('SELECT track_id FROM notifications WHERE user_id = ?').all(userId) as { track_id: number }[];
  return { db, provider, sync, user, artist, subscribe, notifications };
}

describe('SyncService', () => {
  it('imports the back catalogue silently on the first sync', async () => {
    const { provider, sync, user, artist, subscribe, notifications } = setup();
    const alice = user('alice');
    subscribe(alice);
    provider.tracks = [track('1'), track('2')];

    const result = await sync.syncArtist(artist);
    assert.equal(result.newTracks, 2);
    assert.equal(result.error, null);
    assert.equal(notifications(alice).length, 0);
  });

  it('notifies subscribers about tracks discovered later, once', async () => {
    const { db, provider, sync, user, artist, subscribe, notifications } = setup();
    const alice = user('alice');
    const bob = user('bob');
    subscribe(alice);
    subscribe(bob);
    provider.tracks = [track('1')];
    await sync.syncArtist(artist);

    provider.tracks = [track('2'), track('old', { releasedAt: '2001-01-01T00:00:00.000Z' }), track('1')];
    const result = await sync.syncArtist(artist);
    assert.equal(result.newTracks, 2);

    const fresh = db.prepare(`SELECT id FROM tracks WHERE external_id = '2'`).get() as { id: number };
    assert.deepEqual(notifications(alice), [{ track_id: fresh.id }], 'old releases do not notify');
    assert.deepEqual(notifications(bob), [{ track_id: fresh.id }]);

    await sync.syncArtist(artist);
    assert.equal(notifications(alice).length, 1, 'no duplicate notifications');
  });

  it('refreshes stream URLs of known tracks instead of duplicating them', async () => {
    const { db, provider, sync, artist } = setup();
    provider.tracks = [track('1')];
    await sync.syncArtist(artist);
    provider.tracks = [track('1', { streamUrl: 'https://cdn.example/new.mp3' })];
    await sync.syncArtist(artist);
    const rows = db.prepare('SELECT stream_url FROM tracks').all() as { stream_url: string }[];
    assert.deepEqual(rows, [{ stream_url: 'https://cdn.example/new.mp3' }]);
  });

  it('completes tracks first seen in an imported playlist and still announces them', async () => {
    const { db, provider, sync, user, artist, subscribe, notifications } = setup();
    const alice = user('alice');
    subscribe(alice);
    provider.tracks = [track('1')];
    await sync.syncArtist(artist);

    // Someone imports a playlist with the artist's new single before the next sync; playlists lack date and genre.
    sync.storeTracks([track('2', { releasedAt: null, genre: null, album: null })], 'deezer', null);
    provider.tracks = [track('2', { genre: 'Rock', album: 'Single' }), track('1')];
    const result = await sync.syncArtist(artist);

    const row = db.prepare(`SELECT id, external_artist_id, released_at, genre, album FROM tracks WHERE external_id = '2'`).get() as {
      id: number;
      external_artist_id: number;
      released_at: string | null;
      genre: string | null;
      album: string | null;
    };
    assert.equal(row.external_artist_id, artist);
    assert.ok(row.released_at);
    assert.ok(row.genre);
    assert.equal(row.album, 'Single');
    assert.equal(result.newTracks, 1);
    assert.deepEqual(notifications(alice), [{ track_id: row.id }]);
  });

  it('records provider errors on the artist', async () => {
    const { db, provider, sync, artist } = setup();
    provider.fail = 'service down';
    const result = await sync.syncArtist(artist);
    assert.equal(result.error, 'service down');
    const row = db.prepare('SELECT last_error, last_synced_at FROM external_artists WHERE id = ?').get(artist);
    assert.deepEqual(row, { last_error: 'service down', last_synced_at: null });
  });

  it('shares one run between concurrent syncs of the same artist', async () => {
    const { provider, sync, artist } = setup();
    let calls = 0;
    provider.getArtistTracks = async () => {
      calls++;
      return [track('1')];
    };
    await Promise.all([sync.syncArtist(artist), sync.syncArtist(artist)]);
    assert.equal(calls, 1);
  });

  it('syncs only artists that have subscribers', async () => {
    const { provider, sync, user, subscribe } = setup();
    provider.tracks = [track('1')];
    assert.equal((await sync.syncAll()).artists, 0);
    subscribe(user('alice'));
    assert.deepEqual(await sync.syncAll(), { artists: 1, newTracks: 1, errors: [] });
  });
});
