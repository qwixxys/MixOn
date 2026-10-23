import type { DB } from '../db/index.js';
import { cleanTitle, normalizeText, primaryArtist } from '../lib/matching.js';
import { getTrackRow, queryTracks, type TrackDTO } from '../lib/tracks.js';
import type { SongVersions } from '../lib/versions.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { ExternalTrack, MusicProvider, ProviderContext } from '../providers/types.js';
import type { SyncService } from '../sync/syncService.js';

/**
 * «Моя волна»: an endless stream picked for one listener. It starts from the artists they like, play and follow,
 * brings in songs like theirs (Deezer's artist radio, SoundCloud's related tracks), mixes in favourites and what is
 * popular, and keeps out what they turned down. The client asks for the next batch as the queue runs low.
 */
export const WAVE_MODES = ['mix', 'favorite', 'discover', 'popular'] as const;
/** mix: new songs with some favourites; favorite: mostly favourites; discover: only unfamiliar artists; popular. */
export type WaveMode = (typeof WAVE_MODES)[number];

interface Song {
  id: number;
  title: string;
  artist: string;
  source: string;
  external_id: string | null;
  /** 1 for a preview (Deezer, Apple Music, a SoundCloud Go snippet); read for candidates only. */
  is_preview?: number;
}

const DAY = 86400_000;
/** What was played this recently does not come back (favourites: after a day). */
const REPEAT_AFTER_DAYS = 3;
const FAVORITE_REPEAT_AFTER_DAYS = 1;
/** Artists the wave starts from in one batch. */
const SEEDS = 3;
/** Songs of one artist in one batch. */
const PER_ARTIST = 2;
/** A service that takes longer is left out of this batch. */
const SOURCE_TIMEOUT_MS = 8000;
/** Candidates looked at per song asked for, as some previews have no full version anywhere. */
const CANDIDATES_PER_SONG = 2;
/** Full versions of previews looked up at once, and the time a batch may spend on them. */
const LOOKUPS_AT_ONCE = 4;
const LOOKUP_BUDGET_MS = 15_000;
const RECOMMENDATIONS_TTL_MS = 30 * 60_000;

/** Share of each pool in a batch, by mode; whatever a pool cannot fill is filled from the others. */
const SHARES: Record<WaveMode, Partial<Record<Pool, number>>> = {
  mix: { similar: 0.6, favorites: 0.2, followed: 0.1, popular: 0.1 },
  favorite: { favorites: 0.5, similar: 0.3, followed: 0.2 },
  discover: { similar: 1 },
  popular: { popular: 0.7, similar: 0.3 },
};
type Pool = 'similar' | 'favorites' | 'followed' | 'popular';

export const artistKey = (artist: string) => normalizeText(primaryArtist(artist));
const songKey = (t: { title: string; artist: string }) => `${artistKey(t.artist)}|${normalizeText(cleanTitle(t.title))}`;

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `n` distinct items, each drawn with a chance proportional to its weight. */
function pickWeighted<T>(items: { item: T; weight: number }[], n: number): T[] {
  const left = items.filter((x) => x.weight > 0);
  const picked: T[] = [];
  while (picked.length < n && left.length) {
    let roll = Math.random() * left.reduce((sum, x) => sum + x.weight, 0);
    const i = Math.max(0, left.findIndex((x) => (roll -= x.weight) <= 0));
    picked.push(left[i].item);
    left.splice(i, 1);
  }
  return picked;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

export class WaveService {
  private recommendations = new Map<number, { tracks: TrackDTO[]; preferred: string | null; until: number }>();

  constructor(
    private db: DB,
    private providers: ProviderRegistry,
    private sync: SyncService,
    private versions: SongVersions,
  ) {}

  dislike(userId: number, trackId: number) {
    this.db.prepare('INSERT OR IGNORE INTO wave_dislikes (user_id, track_id) VALUES (?, ?)').run(userId, trackId);
    this.recommendations.delete(userId);
  }

  undoDislike(userId: number, trackId: number) {
    this.db.prepare('DELETE FROM wave_dislikes WHERE user_id = ? AND track_id = ?').run(userId, trackId);
  }

  /** A dozen songs for the feed, kept for half an hour so the feed does not change at every visit. */
  async recommend(userId: number, preferred: string | null, refresh = false): Promise<TrackDTO[]> {
    const kept = this.recommendations.get(userId);
    if (kept && kept.until > Date.now() && kept.preferred === preferred && !refresh) return kept.tracks;
    const tracks = await this.next(userId, { mode: 'mix', exclude: [], limit: 12, preferred });
    this.recommendations.set(userId, { tracks, preferred, until: Date.now() + RECOMMENDATIONS_TTL_MS });
    return tracks;
  }

  /**
   * The next `limit` songs of the wave, none of `exclude` (what the listener's queue already has), all whole songs:
   * a preview comes as its full version from `preferred` (the service chosen to listen through) or another service.
   */
  async next(
    userId: number,
    { mode, exclude, limit, preferred = null }: { mode: WaveMode; exclude: number[]; limit: number; preferred?: string | null },
  ): Promise<TrackDTO[]> {
    const taste = this.taste(userId);
    const seeds = this.seeds(taste, mode === 'popular' ? 1 : SEEDS);

    // Songs like the seeds and, for newcomers or the «popular» mode, the services' charts.
    const services = this.providers.list().filter((p) => p.isConfigured());
    const fetched = await Promise.all([
      ...seeds.flatMap((seed) =>
        services.flatMap((p) =>
          p.similarTracks
            ? [
                this.fromService(p, userId, (ctx) =>
                  p.similarTracks!({ artist: seed.artist, title: seed.song?.title ?? '', externalId: seed.song?.source === p.id ? seed.song.external_id : null }, ctx),
                ).then((ids) => ({ pool: 'similar' as const, ids })),
              ]
            : [],
        ),
      ),
      ...(mode === 'popular' || !seeds.length
        ? services.flatMap((p) =>
            p.popularTracks ? [this.fromService(p, userId, (ctx) => p.popularTracks!(ctx)).then((ids) => ({ pool: 'popular' as const, ids }))] : [],
          )
        : []),
    ]);

    const pools: Record<Pool, number[]> = {
      similar: fetched.filter((f) => f.pool === 'similar').flatMap((f) => f.ids),
      popular: [...fetched.filter((f) => f.pool === 'popular').flatMap((f) => f.ids), ...this.ids(`SELECT id FROM tracks WHERE play_count > 0 ORDER BY play_count DESC LIMIT 50`)],
      favorites: taste.liked.map((s) => s.id),
      followed: this.ids(
        `SELECT t.id FROM tracks t JOIN subscriptions s ON s.external_artist_id = t.external_artist_id AND s.user_id = ?
         ORDER BY t.released_at DESC, t.id DESC LIMIT 60`,
        userId,
      ),
    };
    if (mode === 'discover') pools.favorites = pools.followed = [];

    const songs = this.songs([...new Set([...Object.values(pools).flat(), ...exclude])]);
    const recentSince = (days: number) => new Date(Date.now() - days * DAY).toISOString();
    const playedSince = (days: number) =>
      new Set(this.ids(`SELECT DISTINCT track_id AS id FROM plays WHERE user_id = ? AND created_at >= ?`, userId, recentSince(days)));
    const recent = playedSince(REPEAT_AFTER_DAYS);
    const recentFavorites = playedSince(FAVORITE_REPEAT_AFTER_DAYS);
    const excludeKeys = new Set(exclude.map((id) => songs.get(id)).filter((s): s is Song => Boolean(s)).map(songKey));
    const taken = new Set(exclude);
    const takenKeys = new Set(excludeKeys);
    const candidates: number[] = [];

    const fits = (id: number, pool: Pool) => {
      const song = songs.get(id);
      if (!song || taken.has(id) || takenKeys.has(songKey(song)) || taste.disliked.has(id)) return false;
      const artist = artistKey(song.artist);
      if (taste.blockedArtists.has(artist)) return false;
      if ((pool === 'favorites' ? recentFavorites : recent).has(id)) return false;
      // «Незнакомое»: artists the listener already likes, plays or follows stay out.
      if (mode === 'discover' && (taste.artists.get(artist)?.score ?? 0) > 0) return false;
      return true;
    };
    const take = (pool: Pool, want: number) => {
      // Whole songs first: a preview costs a search for its full version.
      const order = shuffle(pools[pool]).sort((a, b) => (songs.get(a)?.is_preview ?? 1) - (songs.get(b)?.is_preview ?? 1));
      for (const id of order) {
        if (want <= 0) break;
        if (!fits(id, pool)) continue;
        taken.add(id);
        takenKeys.add(songKey(songs.get(id)!));
        candidates.push(id);
        want--;
      }
    };

    // More candidates than songs asked for: previews that no service has in full drop out below.
    const target = limit * CANDIDATES_PER_SONG;
    for (const [pool, share] of Object.entries(SHARES[mode]) as [Pool, number][]) take(pool, Math.round(share * target));
    for (const pool of ['similar', 'popular', 'followed', 'favorites'] as Pool[]) take(pool, target - candidates.length);
    // Nothing reached the services (offline, or a new app with no history): whatever the app has.
    if (candidates.length < target) {
      const rest = this.ids(`SELECT id FROM tracks ORDER BY random() LIMIT 200`);
      for (const s of this.songs(rest).values()) songs.set(s.id, s);
      pools.popular = rest;
      take('popular', target - candidates.length);
    }

    // The wave plays whole songs only: a preview becomes the full song from another service, or drops out.
    const chosen: Song[] = [];
    const chosenIds = new Set<number>();
    const chosenKeys = new Set(excludeKeys);
    const perArtist = new Map<string, number>();
    const deadline = Date.now() + LOOKUP_BUDGET_MS;
    for (let i = 0; i < candidates.length && chosen.length < limit && Date.now() < deadline; i += LOOKUPS_AT_ONCE) {
      const whole = await Promise.all(candidates.slice(i, i + LOOKUPS_AT_ONCE).map((id) => this.whole(userId, songs.get(id)!, preferred)));
      for (const song of whole) {
        if (!song || chosen.length >= limit) continue;
        const artist = artistKey(song.artist);
        const key = songKey(song);
        if (exclude.includes(song.id) || chosenIds.has(song.id) || chosenKeys.has(key) || taste.disliked.has(song.id)) continue;
        if (taste.blockedArtists.has(artist) || (perArtist.get(artist) ?? 0) >= PER_ARTIST) continue;
        chosen.push(song);
        chosenIds.add(song.id);
        chosenKeys.add(key);
        perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
      }
    }

    const order = new Map(spread(chosen, (song) => artistKey(song.artist)).map((song, i) => [song.id, i]));
    return queryTracks(this.db, 'WHERE t.id IN (SELECT value FROM json_each(@ids))', { ids: JSON.stringify([...order.keys()]) }, userId).sort(
      (a, b) => order.get(a.id)! - order.get(b.id)!,
    );
  }

  /** `song` as a whole song: itself, or for a preview its full version (from `preferred` first); null if none. */
  private async whole(userId: number, song: Song, preferred: string | null): Promise<Song | null> {
    if (!song.is_preview) return song;
    const row = getTrackRow(this.db, song.id);
    if (!row) return null;
    try {
      const full = await this.versions.full(userId, row, preferred);
      return full && !full.isPreview ? { id: full.id, title: full.title, artist: full.artist, source: full.source, external_id: null, is_preview: 0 } : null;
    } catch {
      return null;
    }
  }

  /** What the listener likes: artists weighted by likes, plays and follows; songs and artists they turned down. */
  private taste(userId: number) {
    const liked = this.db
      .prepare(
        `SELECT t.id, t.title, t.artist, t.source, t.external_id FROM likes l JOIN tracks t ON t.id = l.track_id
         WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 300`,
      )
      .all(userId) as Song[];
    const played = this.db
      .prepare(
        `SELECT t.id, t.title, t.artist, t.source, t.external_id, COUNT(*) AS n FROM plays p JOIN tracks t ON t.id = p.track_id
         WHERE p.user_id = ? AND p.created_at >= ? GROUP BY t.id ORDER BY MAX(p.created_at) DESC LIMIT 300`,
      )
      .all(userId, new Date(Date.now() - 90 * DAY).toISOString()) as (Song & { n: number })[];
    const followed = this.db
      .prepare('SELECT ea.name FROM subscriptions s JOIN external_artists ea ON ea.id = s.external_artist_id WHERE s.user_id = ?')
      .all(userId) as { name: string }[];
    const dislikedRows = this.db
      .prepare('SELECT t.id, t.artist FROM wave_dislikes d JOIN tracks t ON t.id = d.track_id WHERE d.user_id = ?')
      .all(userId) as { id: number; artist: string }[];

    // The newest song of an artist stands for them when a service looks for similar ones.
    const artists = new Map<string, { name: string; score: number; song: Song | null }>();
    const add = (name: string, score: number, song: Song | null) => {
      const key = artistKey(name);
      if (!key) return;
      const known = artists.get(key) ?? { name: primaryArtist(name), score: 0, song: null };
      known.score += score;
      known.song ??= song;
      artists.set(key, known);
    };
    for (const s of liked) add(s.artist, 3, s);
    for (const s of played) add(s.artist, Math.min(s.n, 5), s);
    for (const a of followed) add(a.name, 5, null);
    const dislikesByArtist = new Map<string, number>();
    for (const d of dislikedRows) {
      const key = artistKey(d.artist);
      dislikesByArtist.set(key, (dislikesByArtist.get(key) ?? 0) + 1);
      const known = artists.get(key);
      if (known) known.score -= 4;
    }
    return {
      liked,
      artists,
      disliked: new Set(dislikedRows.map((d) => d.id)),
      // A second turned-down song of the same artist keeps the artist out.
      blockedArtists: new Set([...dislikesByArtist].filter(([, n]) => n >= 2).map(([key]) => key)),
    };
  }

  /** Artists to start from, the ones the listener likes more being likelier. */
  private seeds(taste: ReturnType<WaveService['taste']>, n: number) {
    return pickWeighted(
      [...taste.artists.values()].map((a) => ({ item: { artist: a.name, song: a.song }, weight: a.score })),
      n,
    );
  }

  /** Songs from a service, stored in the catalogue; nothing when the service fails, is slow or is not set up. */
  private async fromService(provider: MusicProvider, userId: number, get: (ctx: ProviderContext) => Promise<ExternalTrack[]>): Promise<number[]> {
    try {
      const tracks = await withTimeout(
        (async () => get({ token: await this.sync.userToken(provider.id, userId) }))(),
        SOURCE_TIMEOUT_MS,
      );
      return tracks.length ? this.sync.storeTracks(tracks, provider.id, null).ids : [];
    } catch {
      return [];
    }
  }

  private ids(sql: string, ...params: unknown[]): number[] {
    return (this.db.prepare(sql).all(...params) as { id: number }[]).map((r) => r.id);
  }

  private songs(ids: number[]): Map<number, Song> {
    const rows = this.db
      .prepare('SELECT id, title, artist, source, external_id, is_preview FROM tracks WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids)) as Song[];
    return new Map(rows.map((r) => [r.id, r]));
  }
}

/** The same items, shuffled so that one artist's songs do not follow each other where it can be helped. */
function spread<T>(items: T[], group: (item: T) => string): T[] {
  const left = shuffle(items);
  const out: T[] = [];
  while (left.length) {
    const previous = out.length ? group(out[out.length - 1]) : null;
    const i = left.findIndex((item) => group(item) !== previous);
    out.push(...left.splice(i === -1 ? 0 : i, 1));
  }
  return out;
}
