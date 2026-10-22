import type { DB } from '../db/index.js';
import { cleanTitle, closeness, normalizeText, primaryArtist, songQuery } from '../lib/matching.js';
import type { TrackRow } from '../lib/tracks.js';
import type { GeniusArtistRaw, GeniusClient, GeniusHitRaw, GeniusSongRaw } from './client.js';

/** Song details are refreshed after this long. */
const SONG_TTL_MS = 7 * 86400_000;
/** Tracks with no match are searched again after this long (new songs appear on Genius). */
const NO_MATCH_RETRY_MS = 14 * 86400_000;
const DESCRIPTION_LIMIT = 2000;

export interface GeniusPerson {
  id: number;
  name: string;
  url: string | null;
  imageUrl: string | null;
}

export interface GeniusSongRef {
  id: number;
  title: string;
  artist: string;
  url: string;
  imageUrl: string | null;
  releaseDate: string | null;
}

export interface GeniusSong extends GeniusSongRef {
  fullTitle: string;
  primaryArtist: GeniusPerson;
  featured: GeniusPerson[];
  writers: GeniusPerson[];
  producers: GeniusPerson[];
  /** Other credits ("Mixing Engineer", "Label"…), as Genius labels them. */
  credits: { label: string; people: GeniusPerson[] }[];
  album: { name: string; url: string | null; coverUrl: string | null } | null;
  description: string | null;
  relationships: { type: string; label: string; songs: GeniusSongRef[] }[];
  media: { provider: string; url: string }[];
  recordingLocation: string | null;
  pageviews: number | null;
  /** Genius's official embed snippet that renders the lyrics; loaded from genius.com by the browser. */
  embedContent: string | null;
}

const RELATIONSHIPS: Record<string, string> = {
  samples: 'Использует сэмплы',
  sampled_in: 'Сэмплирован в',
  interpolates: 'Интерполирует',
  interpolated_by: 'Интерполирован в',
  cover_of: 'Кавер на',
  covered_by: 'Каверы',
  remix_of: 'Ремикс на',
  remixed_by: 'Ремиксы',
  live_version_of: 'Живая версия',
  performed_live_as: 'Исполнялся вживую как',
  translation_of: 'Перевод песни',
  translations: 'Переводы',
};

const person = (a: GeniusArtistRaw): GeniusPerson => ({ id: a.id, name: a.name, url: a.url ?? null, imageUrl: a.image_url ?? null });

const songRef = (s: GeniusHitRaw): GeniusSongRef => ({
  id: s.id,
  title: s.title,
  artist: s.primary_artist?.name ?? '',
  url: s.url,
  imageUrl: s.song_art_image_thumbnail_url ?? null,
  releaseDate: s.release_date_for_display ?? null,
});

export function toGeniusSong(s: GeniusSongRaw): GeniusSong {
  const plain = s.description?.plain?.trim();
  return {
    ...songRef(s),
    fullTitle: s.full_title ?? `${s.title} — ${s.primary_artist?.name ?? ''}`,
    primaryArtist: person(s.primary_artist),
    featured: (s.featured_artists ?? []).map(person),
    writers: (s.writer_artists ?? []).map(person),
    producers: (s.producer_artists ?? []).map(person),
    credits: (s.custom_performances ?? [])
      .filter((c) => c.artists?.length)
      .map((c) => ({ label: c.label, people: c.artists.map(person) })),
    album: s.album ? { name: s.album.name, url: s.album.url ?? null, coverUrl: s.album.cover_art_url ?? null } : null,
    // Genius uses "?" for songs nobody has described yet.
    description: plain && plain !== '?' ? plain.slice(0, DESCRIPTION_LIMIT) : null,
    relationships: (s.song_relationships ?? [])
      .filter((r) => RELATIONSHIPS[r.relationship_type] && r.songs?.length)
      .map((r) => ({ type: r.relationship_type, label: RELATIONSHIPS[r.relationship_type], songs: r.songs.slice(0, 10).map(songRef) })),
    media: (s.media ?? []).filter((m) => /^https:\/\//.test(m.url)).map((m) => ({ provider: m.provider, url: m.url })),
    recordingLocation: s.recording_location || null,
    pageviews: s.stats?.pageviews ?? null,
    embedContent: s.embed_content || null,
  };
}

// ---------- matching soundFy tracks to Genius songs ----------

export { cleanTitle, normalizeText, primaryArtist };

/** Picks the hit that matches both title and artist; null when nothing is convincing. */
export function pickMatch(hits: GeniusHitRaw[], track: { title: string; artist: string }): GeniusHitRaw | null {
  const { title, artist } = songQuery(track);
  const wantTitle = normalizeText(title);
  const wantArtist = normalizeText(artist);

  let best: { hit: GeniusHitRaw; score: number } | null = null;
  for (const hit of hits) {
    const t = closeness(normalizeText(hit.title), wantTitle);
    const a = Math.max(closeness(normalizeText(hit.primary_artist?.name ?? ''), wantArtist), normalizeText(hit.full_title ?? '').includes(wantArtist) ? 1 : 0);
    if (!t || !a || t + a < 3) continue;
    if (!best || t + a > best.score) best = { hit, score: t + a };
  }
  return best?.hit ?? null;
}

export function searchQuery(track: { title: string; artist: string }) {
  return `${primaryArtist(track.artist)} ${cleanTitle(track.title)}`.trim();
}

// ---------- service ----------

export interface TrackGenius {
  configured: boolean;
  song: GeniusSong | null;
  /** True when someone linked the song by hand. */
  manual: boolean;
}

export class GeniusService {
  private inflight = new Map<number, Promise<TrackGenius>>();

  constructor(
    private db: DB,
    private client: GeniusClient,
  ) {}

  /** A new token from the app's settings. */
  setToken(token: string | null) {
    this.client.setToken(token);
  }

  isConfigured() {
    return this.client.isConfigured();
  }

  async search(query: string): Promise<GeniusSongRef[]> {
    return (await this.client.search(query)).slice(0, 10).map(songRef);
  }

  forTrack(track: TrackRow): Promise<TrackGenius> {
    const running = this.inflight.get(track.id);
    if (running) return running;
    const job = this.load(track).finally(() => this.inflight.delete(track.id));
    this.inflight.set(track.id, job);
    return job;
  }

  private async load(track: TrackRow): Promise<TrackGenius> {
    if (!this.client.isConfigured()) return { configured: false, song: null, manual: false };
    let geniusId = track.genius_id;
    const manual = Boolean(track.genius_manual);
    const checkedAt = track.genius_checked_at ? Date.parse(track.genius_checked_at) : 0;

    if (!manual && !geniusId && Date.now() - checkedAt > NO_MATCH_RETRY_MS) {
      const hit = pickMatch(await this.client.search(searchQuery(track)), track);
      geniusId = hit?.id ?? null;
      this.db
        .prepare(`UPDATE tracks SET genius_id = ?, genius_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
        .run(geniusId, track.id);
    }
    if (!geniusId) return { configured: true, song: null, manual };
    return { configured: true, song: await this.song(geniusId), manual };
  }

  /** Song details, from cache when fresh; a stale copy is used if Genius is unreachable. */
  async song(id: number): Promise<GeniusSong> {
    const cached = this.db.prepare('SELECT data, fetched_at FROM genius_songs WHERE id = ?').get(id) as
      | { data: string; fetched_at: string }
      | undefined;
    if (cached && Date.now() - Date.parse(cached.fetched_at) < SONG_TTL_MS) return JSON.parse(cached.data);
    try {
      const song = toGeniusSong(await this.client.song(id));
      this.db
        .prepare(
          `INSERT INTO genius_songs (id, data, fetched_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT (id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
        )
        .run(id, JSON.stringify(song));
      return song;
    } catch (err) {
      if (cached) return JSON.parse(cached.data);
      throw err;
    }
  }

  /** Links a track to a Genius song by hand, or marks it as having none (null). */
  async link(track: TrackRow, geniusId: number | null): Promise<TrackGenius> {
    if (geniusId) await this.song(geniusId);
    this.db
      .prepare(
        `UPDATE tracks SET genius_id = ?, genius_manual = 1, genius_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      )
      .run(geniusId, track.id);
    return { configured: true, song: geniusId ? await this.song(geniusId) : null, manual: true };
  }
}
