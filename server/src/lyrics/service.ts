import type { DB } from '../db/index.js';
import { cleanTitle, closeness, normalizeText, primaryArtist, songQuery } from '../lib/matching.js';
import type { TrackRow } from '../lib/tracks.js';
import { parseLrc, type LrclibClient, type LrclibRecord, type LyricLine } from './lrclib.js';

/** Found lyrics are re-checked after a month, misses after a few days (new lyrics get added). */
const FOUND_TTL_MS = 30 * 86400_000;
const MISS_TTL_MS = 3 * 86400_000;
/** How far (seconds) a search hit's duration may be from the track's. */
const DURATION_TOLERANCE = 4;
/** Longer lyrics than this are not stored; real songs are far shorter. */
const MAX_LYRICS_LENGTH = 100_000;
/** Sources whose titles are often "Artist - Song" written by someone else's account. */
const UPLOAD_SOURCES = new Set(['local', 'soundcloud']);

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
    // Search results are community data: skip empty and absurdly long records before matching on them.
    .filter((r) => (r.syncedLyrics || r.plainLyrics || r.instrumental) && (r.trackName?.length ?? 0) < 500 && (r.artistName?.length ?? 0) < 500)
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
      const names = UPLOAD_SOURCES.has(track.source) ? songQuery(track) : { title: cleanTitle(track.title), artist: primaryArtist(track.artist) };
      const query = { ...names, album: track.album, duration: track.duration };
      // A differently named album makes the exact lookup miss, so try again without it.
      record = (await this.lrclib.get(query)) ?? (query.album ? await this.lrclib.get({ ...query, album: null }) : null);
      // The exact lookup returns the oldest match, which may be plain text while a synced version exists.
      if (!record?.syncedLyrics && !record?.instrumental) {
        try {
          const found = pickRecord(await this.lrclib.search(query), query);
          if (found && (found.syncedLyrics || !record)) record = found;
        } catch (err) {
          // Search is only an extra here; keep the plain lyrics already found.
          if (!record) throw err;
        }
      }
    } catch (err) {
      // Keep serving what we had if LRCLIB is down.
      if (cached) return this.toLyrics(cached);
      throw err;
    }

    const fit = (text: string | null | undefined) => (text && text.length <= MAX_LYRICS_LENGTH ? text : null);
    const synced = fit(record?.syncedLyrics);
    const plain = fit(record?.plainLyrics);
    const row: CacheRow = {
      source: record && (synced || plain || record.instrumental) ? 'lrclib' : null,
      synced,
      plain,
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
      .run({ ...row, trackId: track.id, externalId: row.source && record ? String(record.id) : null });
    return this.toLyrics(row);
  }
}
