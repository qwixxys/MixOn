import { fetchJson, ProviderError, RateLimiter, type FetchLike } from '../lib/http.js';

/** A lyrics record as LRCLIB returns it (https://lrclib.net/docs). */
export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  /** Seconds. */
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

/** Bounds for community-submitted lyrics, so one odd record cannot blow up a response. */
const MAX_STAMPS_PER_LINE = 10;
const MAX_LINES = 3000;
const MAX_LINE_LENGTH = 1000;

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

/**
 * Parses LRC ("[01:23.45] text"). Only the timestamps at the start of a line count, and a line may repeat under
 * several of them; metadata tags such as [ar:…] are ignored and an [offset:±ms] tag is applied. Word timings inside
 * a line (<01:23.45> or [01:23.45]) are dropped. Lines come back sorted by time.
 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let offset = 0;
  for (const raw of lrc.split(/\r?\n/)) {
    const meta = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (meta) {
      offset = Number(meta[1]) / 1000;
      continue;
    }
    const head = raw.match(/^\s*(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+/);
    if (!head) continue;
    const text = raw
      .slice(head[0].length)
      .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>|\[\d{1,3}:\d{1,2}[.:]\d{1,3}\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_LINE_LENGTH);
    for (const s of [...head[0].matchAll(STAMP)].slice(0, MAX_STAMPS_PER_LINE)) {
      const time = Number(s[1]) * 60 + Number(s[2].replace(':', '.')) - offset;
      lines.push({ time: Math.max(0, Math.round(time * 1000) / 1000), text });
    }
    if (lines.length >= MAX_LINES) break;
  }
  return lines.slice(0, MAX_LINES).sort((a, b) => a.time - b.time);
}

/** LRCLIB: free, community-run lyrics database; no API key. */
export class LrclibClient {
  // LRCLIB asks clients to send requests one after another with a short pause.
  private limiter: RateLimiter;

  constructor(
    private baseUrl: string | null,
    private userAgent: string,
    private fetchImpl: FetchLike = fetch,
    intervalMs = 300,
  ) {
    this.limiter = new RateLimiter(intervalMs);
  }

  isEnabled() {
    return Boolean(this.baseUrl);
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = `${this.baseUrl}${path}?${new URLSearchParams(params)}`;
    try {
      await this.limiter.wait();
      // LRCLIB requires clients to identify themselves ("<app> v<version> (<homepage>)").
      return await fetchJson<T>(this.fetchImpl, 'lrclib', url, {
        headers: { 'user-agent': this.userAgent, 'lrclib-client': this.userAgent, accept: 'application/json' },
      });
    } catch (err) {
      if (err instanceof ProviderError && err.code === 404) return null;
      throw err;
    }
  }

  /**
   * Exact lookup: names must match after LRCLIB's normalisation, the album too when given, and the duration within ±2 s.
   * A record without any lyrics counts as not found.
   */
  async get(q: { artist: string; title: string; album?: string | null; duration: number }): Promise<LrclibRecord | null> {
    const params: Record<string, string> = { artist_name: q.artist, track_name: q.title };
    // LRCLIB rejects durations outside 1..3600 s; without one it matches on the names alone.
    if (q.duration >= 1 && q.duration <= 3600) params.duration = String(Math.round(q.duration));
    if (q.album) params.album_name = q.album;
    const record = await this.request<LrclibRecord>('/api/get', params);
    return record && (record.syncedLyrics || record.plainLyrics || record.instrumental) ? record : null;
  }

  async search(q: { artist: string; title: string }): Promise<LrclibRecord[]> {
    return (await this.request<LrclibRecord[]>('/api/search', { track_name: q.title, artist_name: q.artist })) ?? [];
  }
}
