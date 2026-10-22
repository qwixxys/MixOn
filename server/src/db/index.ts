import Database from 'better-sqlite3';
import { normalizeGenre } from '../lib/genres.js';

export type DB = Database.Database;

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// Each entry upgrades the schema by one version (tracked in PRAGMA user_version):
// plain SQL, or a function for data migrations that need application code.
const migrations: (string | ((db: DB) => void))[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    avatar_path   TEXT,
    created_at    TEXT NOT NULL DEFAULT ${NOW}
  );

  -- Artists on external services that users subscribe to.
  CREATE TABLE external_artists (
    id             INTEGER PRIMARY KEY,
    provider       TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    name           TEXT NOT NULL,
    image_url      TEXT,
    url            TEXT,
    last_synced_at TEXT,
    last_error     TEXT,
    created_at     TEXT NOT NULL DEFAULT ${NOW},
    UNIQUE (provider, external_id)
  );

  -- Both tracks uploaded to soundFy (source = 'local') and tracks imported from services.
  CREATE TABLE tracks (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER REFERENCES users(id) ON DELETE CASCADE,
    external_artist_id INTEGER REFERENCES external_artists(id) ON DELETE SET NULL,
    source             TEXT NOT NULL DEFAULT 'local',
    external_id        TEXT,
    title              TEXT NOT NULL,
    artist             TEXT NOT NULL,
    album              TEXT,
    description        TEXT NOT NULL DEFAULT '',
    genre              TEXT,
    duration           REAL NOT NULL DEFAULT 0,
    audio_path         TEXT,
    audio_mime         TEXT,
    stream_url         TEXT,
    cover_path         TEXT,
    cover_url          TEXT,
    external_url       TEXT,
    is_preview         INTEGER NOT NULL DEFAULT 0,
    waveform           TEXT,
    extra              TEXT,
    play_count         INTEGER NOT NULL DEFAULT 0,
    released_at        TEXT,
    created_at         TEXT NOT NULL DEFAULT ${NOW},
    UNIQUE (source, external_id)
  );
  CREATE INDEX tracks_user_idx ON tracks (user_id, created_at);
  CREATE INDEX tracks_artist_idx ON tracks (external_artist_id, released_at);
  CREATE INDEX tracks_released_idx ON tracks (released_at);

  CREATE TABLE likes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (user_id, track_id)
  );
  CREATE INDEX likes_track_idx ON likes (track_id);

  CREATE TABLE comments (
    id         INTEGER PRIMARY KEY,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    at_seconds REAL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX comments_track_idx ON comments (track_id, created_at);

  CREATE TABLE follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
  );
  CREATE INDEX follows_followee_idx ON follows (followee_id);

  CREATE TABLE playlists (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_public   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT ${NOW},
    updated_at  TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_at    TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (playlist_id, track_id)
  );

  CREATE TABLE plays (
    id         INTEGER PRIMARY KEY,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX plays_track_idx ON plays (track_id, created_at);
  CREATE INDEX plays_user_idx ON plays (user_id, created_at);

  CREATE TABLE subscriptions (
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_artist_id INTEGER NOT NULL REFERENCES external_artists(id) ON DELETE CASCADE,
    created_at         TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (user_id, external_artist_id)
  );
  CREATE INDEX subscriptions_artist_idx ON subscriptions (external_artist_id);

  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    UNIQUE (user_id, track_id, type)
  );
  CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at);

  -- Per-user credentials for services that need them (e.g. VK access token).
  CREATE TABLE service_connections (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider         TEXT NOT NULL,
    access_token     TEXT NOT NULL,
    external_user_id TEXT,
    display_name     TEXT,
    created_at       TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (user_id, provider)
  );
  `,
  `
  -- OAuth services (SoundCloud) hand out short-lived tokens that must be refreshed.
  ALTER TABLE service_connections ADD COLUMN refresh_token TEXT;
  ALTER TABLE service_connections ADD COLUMN expires_at TEXT;

  -- Small server-wide key/value store (e.g. cached app access tokens).
  CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Genius song a track is linked to (NULL with a check time means "searched, nothing found").
  ALTER TABLE tracks ADD COLUMN genius_id INTEGER;
  ALTER TABLE tracks ADD COLUMN genius_checked_at TEXT;
  ALTER TABLE tracks ADD COLUMN genius_manual INTEGER NOT NULL DEFAULT 0;

  -- Cached song details from the Genius API.
  CREATE TABLE genius_songs (
    id         INTEGER PRIMARY KEY,
    data       TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  CREATE INDEX tracks_genre_idx ON tracks (genre COLLATE NOCASE);
  `,
  // Fold genre spellings from different services into one name per genre.
  (db) => {
    const update = db.prepare('UPDATE tracks SET genre = ? WHERE id = ?');
    for (const row of db.prepare('SELECT id, genre FROM tracks WHERE genre IS NOT NULL').all() as { id: number; genre: string }[]) {
      const genre = normalizeGenre(row.genre);
      if (genre !== row.genre) update.run(genre, row.id);
    }
  },
];

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function dbStore(db: DB): KeyValueStore {
  return {
    get: (key) => (db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null,
    set: (key, value) => {
      db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
    },
  };
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < migrations.length; version++) {
    const step = migrations[version];
    db.transaction(() => {
      if (typeof step === 'string') db.exec(step);
      else step(db);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

export function openDatabase(file: string): DB {
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // SQLite's lower()/LIKE only fold ASCII; this one handles Cyrillic and other scripts.
  db.function('ulower', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? value.toLocaleLowerCase() : value,
  );
  migrate(db);
  return db;
}
