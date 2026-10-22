import { fetchJson, ProviderError, type FetchLike } from '../lib/http.js';

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

/**
 * Parses LRC ("[01:23.45] text"). A line may carry several timestamps; metadata tags such as
 * [ar:…] are ignored and an [offset:±ms] tag is applied. Lines come back sorted by time.
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
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    // Strip leading timestamps and inline word stamps (<mm:ss.xx>) of the "enhanced" LRC flavour.
    const text = raw.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const s of stamps) {
      const time = Number(s[1]) * 60 + Number(s[2].replace(':', '.')) - offset;
      lines.push({ time: Math.max(0, Math.round(time * 1000) / 1000), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** LRCLIB: free, community-run lyrics database; no API key. */
export class LrclibClient {
  constructor(
    private baseUrl: string | null,
    private userAgent: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  isEnabled() {
    return Boolean(this.baseUrl);
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = `${this.baseUrl}${path}?${new URLSearchParams(params)}`;
    try {
      // LRCLIB asks clients to identify themselves with a User-Agent.
      return await fetchJson<T>(this.fetchImpl, 'lrclib', url, { headers: { 'user-agent': this.userAgent, accept: 'application/json' } });
    } catch (err) {
      if (err instanceof ProviderError && err.code === 404) return null;
      throw err;
    }
  }

  /** Exact lookup; LRCLIB only matches when the duration is within a couple of seconds. */
  get(q: { artist: string; title: string; album?: string | null; duration: number }): Promise<LrclibRecord | null> {
    const params: Record<string, string> = { artist_name: q.artist, track_name: q.title };
    // LRCLIB rejects durations outside 1..3600 s; without one it matches on the names alone.
    if (q.duration >= 1 && q.duration <= 3600) params.duration = String(Math.round(q.duration));
    if (q.album) params.album_name = q.album;
    return this.request<LrclibRecord>('/api/get', params);
  }

  async search(q: { artist: string; title: string }): Promise<LrclibRecord[]> {
    return (await this.request<LrclibRecord[]>('/api/search', { track_name: q.title, artist_name: q.artist })) ?? [];
  }
}
