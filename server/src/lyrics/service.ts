import type { DB } from '../db/index.js';
import { cleanTitle, closeness, normalizeText, primaryArtist } from '../lib/matching.js';
import type { TrackRow } from '../lib/tracks.js';
import { parseLrc, type LrclibClient, type LrclibRecord, type LyricLine } from './lrclib.js';

/** Found lyrics are re-checked after a month, misses after a few days (new lyrics get added). */
const FOUND_TTL_MS = 30 * 86400_000;
const MISS_TTL_MS = 3 * 86400_000;
/** How far (seconds) a search hit's duration may be from the track's. */
const DURATION_TOLERANCE = 4;

export interface TrackLyrics {
  enabled: boolean;
  found: boolean;
  source: 'lrclib' | null;
  instrumental: boolean;
  /** Time-synced lines, when available. */
  synced: LyricLine[] | null;
  plain: string | null;
}

interface CacheRow {
  source: string | null;
  synced: string | null;
  plain: string | null;
  instrumental: number;
  fetched_at: string;
}

/** Best search hit: same artist and title, closest duration, synced lyrics preferred. */
export function pickRecord(records: LrclibRecord[], track: { title: string; artist: string; duration: number }): LrclibRecord | null {
  const title = normalizeText(cleanTitle(track.title));
  const artist = normalizeText(primaryArtist(track.artist));
  const scored = records
    .filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental)
    .map((r) => ({
      r,
      title: closeness(normalizeText(cleanTitle(r.trackName)), title),
      artist: closeness(normalizeText(r.artistName), artist),
      drift: track.duration > 0 ? Math.abs(r.duration - track.duration) : 0,
    }))
    .filter((x) => x.title && x.artist && x.drift <= DURATION_TOLERANCE);
  scored.sort((a, b) => b.title + b.artist - (a.title + a.artist) || Number(Boolean(b.r.syncedLyrics)) - Number(Boolean(a.r.syncedLyrics)) || a.drift - b.drift);
  return scored[0]?.r ?? null;
}

export class LyricsService {
  private inflight = new Map<number, Promise<TrackLyrics>>();

  constructor(
    private db: DB,
    private lrclib: LrclibClient,
  ) {}

  forTrack(track: TrackRow): Promise<TrackLyrics> {
    if (!this.lrclib.isEnabled()) return Promise.resolve({ enabled: false, found: false, source: null, instrumental: false, synced: null, plain: null });
    const running = this.inflight.get(track.id);
    if (running) return running;
    const job = this.load(track).finally(() => this.inflight.delete(track.id));
    this.inflight.set(track.id, job);
    return job;
  }

  private toLyrics(row: CacheRow): TrackLyrics {
    const synced = row.synced ? parseLrc(row.synced) : null;
    return {
      enabled: true,
      found: Boolean(row.source),
      source: row.source ? 'lrclib' : null,
      instrumental: Boolean(row.instrumental),
      synced: synced?.length ? synced : null,
      plain: row.plain,
    };
  }

  private async load(track: TrackRow): Promise<TrackLyrics> {
    const cached = this.db.prepare('SELECT source, synced, plain, instrumental, fetched_at FROM lyrics_cache WHERE track_id = ?').get(track.id) as
      | CacheRow
      | undefined;
    const ttl = cached?.source ? FOUND_TTL_MS : MISS_TTL_MS;
    if (cached && Date.now() - Date.parse(cached.fetched_at) < ttl) return this.toLyrics(cached);

    let record: LrclibRecord | null;
    try {
      const query = { artist: primaryArtist(track.artist), title: cleanTitle(track.title), album: track.album, duration: track.duration };
      record = await this.lrclib.get(query);
      if (!record) record = pickRecord(await this.lrclib.search(query), track);
    } catch (err) {
      // Keep serving what we had if LRCLIB is down.
      if (cached) return this.toLyrics(cached);
      throw err;
    }

    const row: CacheRow = {
      source: record ? 'lrclib' : null,
      synced: record?.syncedLyrics ?? null,
      plain: record?.plainLyrics ?? null,
      instrumental: record?.instrumental ? 1 : 0,
      fetched_at: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO lyrics_cache (track_id, source, external_id, synced, plain, instrumental, fetched_at)
         VALUES (@trackId, @source, @externalId, @synced, @plain, @instrumental, @fetched_at)
         ON CONFLICT (track_id) DO UPDATE SET source = excluded.source, external_id = excluded.external_id,
           synced = excluded.synced, plain = excluded.plain, instrumental = excluded.instrumental, fetched_at = excluded.fetched_at`,
      )
      .run({ ...row, trackId: track.id, externalId: record ? String(record.id) : null });
    return this.toLyrics(row);
  }
}
