import type { DB } from '../db/index.js';
import { cleanTitle, closeness, normalizeText, primaryArtist, songQuery } from '../lib/matching.js';
import type { TrackRow } from '../lib/tracks.js';
import type { GeniusArtistFullRaw, GeniusArtistRaw, GeniusClient, GeniusHitRaw, GeniusSongRaw } from './client.js';

/** Song details are refreshed after this long. */
const SONG_TTL_MS = 7 * 86400_000;
/** Tracks and artists with no match are searched again after this long (new pages appear on Genius). */
const NO_MATCH_RETRY_MS = 3 * 86400_000;
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

export interface GeniusArtist {
  id: number;
  name: string;
  url: string | null;
  imageUrl: string | null;
  headerImageUrl: string | null;
  description: string | null;
  alternateNames: string[];
  verified: boolean;
  followers: number | null;
  /** Instagram, X (Twitter), Facebook pages named on Genius. */
  links: { label: string; url: string }[];
  popularSongs: GeniusSongRef[];
}

export interface ArtistGenius {
  configured: boolean;
  artist: GeniusArtist | null;
}

const handle = (value: string | null | undefined) => value?.trim().replace(/^@/, '') || null;

export function toGeniusArtist(a: GeniusArtistFullRaw, songs: GeniusHitRaw[]): GeniusArtist {
  const plain = a.description?.plain?.trim();
  const links: { label: string; url: string }[] = [];
  const instagram = handle(a.instagram_name);
  const twitter = handle(a.twitter_name);
  const facebook = handle(a.facebook_name);
  if (instagram) links.push({ label: 'Instagram', url: `https://www.instagram.com/${encodeURIComponent(instagram)}` });
  if (twitter) links.push({ label: 'X (Twitter)', url: `https://x.com/${encodeURIComponent(twitter)}` });
  if (facebook) links.push({ label: 'Facebook', url: `https://www.facebook.com/${encodeURIComponent(facebook)}` });
  return {
    id: a.id,
    name: a.name,
    url: a.url ?? null,
    imageUrl: a.image_url ?? null,
    headerImageUrl: a.header_image_url ?? null,
    // Genius uses "?" for artists nobody has described yet.
    description: plain && plain !== '?' ? plain.slice(0, DESCRIPTION_LIMIT) : null,
    alternateNames: (a.alternate_names ?? []).filter(Boolean).slice(0, 8),
    verified: Boolean(a.is_verified),
    followers: a.followers_count ?? null,
    links,
    popularSongs: songs.filter((s) => s.primary_artist?.id === a.id).slice(0, 8).map(songRef),
  };
}

/** Name forms of a Genius artist: "Кино (Kino)" also answers to "Кино" and "Kino". */
function nameForms(name: string): string[] {
  const forms = [name, name.replace(/\s*\([^)]*\)\s*/g, ' ')];
  for (const inner of name.matchAll(/\(([^)]+)\)/g)) forms.push(inner[1]);
  return forms.map(normalizeText).filter(Boolean);
}

/**
 * The Genius artist an artist page is about, from song search hits: the primary artist whose name matches exactly
 * (in any of its forms), the one with the most hits when several do. Null when no name matches.
 */
export function pickArtist(hits: GeniusHitRaw[], name: string): GeniusArtistRaw | null {
  const want = normalizeText(primaryArtist(name));
  if (!want) return null;
  const counts = new Map<number, { artist: GeniusArtistRaw; hits: number }>();
  for (const hit of hits) {
    const artist = hit.primary_artist;
    if (!artist || !nameForms(artist.name).includes(want)) continue;
    const entry = counts.get(artist.id) ?? { artist, hits: 0 };
    entry.hits++;
    counts.set(artist.id, entry);
  }
  return [...counts.values()].sort((a, b) => b.hits - a.hits)[0]?.artist ?? null;
}

// ---------- matching MixOn tracks to Genius songs ----------

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

interface ArtistRef {
  id: number;
  name: string;
  genius_id: number | null;
  genius_checked_at: string | null;
}

export class GeniusService {
  private inflight = new Map<number, Promise<TrackGenius>>();
  private inflightArtists = new Map<number, Promise<ArtistGenius>>();

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

  /** Genius info for an artist page, matched by name on first request and cached. */
  forArtist(artist: ArtistRef): Promise<ArtistGenius> {
    const running = this.inflightArtists.get(artist.id);
    if (running) return running;
    const job = this.loadArtist(artist).finally(() => this.inflightArtists.delete(artist.id));
    this.inflightArtists.set(artist.id, job);
    return job;
  }

  private async loadArtist(artist: ArtistRef): Promise<ArtistGenius> {
    if (!this.client.isConfigured()) return { configured: false, artist: null };
    let geniusId = artist.genius_id;
    const checkedAt = artist.genius_checked_at ? Date.parse(artist.genius_checked_at) : 0;
    if (!geniusId && Date.now() - checkedAt > NO_MATCH_RETRY_MS) {
      geniusId = pickArtist(await this.client.search(primaryArtist(artist.name)), artist.name)?.id ?? null;
      this.db
        .prepare(`UPDATE external_artists SET genius_id = ?, genius_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
        .run(geniusId, artist.id);
    }
    if (!geniusId) return { configured: true, artist: null };
    return { configured: true, artist: await this.artistDetails(geniusId) };
  }

  /** Artist details and popular songs, from cache when fresh; a stale copy is used if Genius is unreachable. */
  async artistDetails(id: number): Promise<GeniusArtist> {
    const cached = this.db.prepare('SELECT data, fetched_at FROM genius_artists WHERE id = ?').get(id) as
      | { data: string; fetched_at: string }
      | undefined;
    if (cached && Date.now() - Date.parse(cached.fetched_at) < SONG_TTL_MS) return JSON.parse(cached.data);
    try {
      const [raw, songs] = await Promise.all([this.client.artist(id), this.client.artistSongs(id).catch(() => [])]);
      const artist = toGeniusArtist(raw, songs);
      this.db
        .prepare(
          `INSERT INTO genius_artists (id, data, fetched_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT (id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
        )
        .run(id, JSON.stringify(artist));
      return artist;
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
