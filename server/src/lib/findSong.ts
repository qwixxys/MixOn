import type { ExternalTrack, MusicProvider } from '../providers/types.js';
import { cleanTitle, closeness, normalizeText, songQuery } from './matching.js';

export interface WantedSong {
  title: string;
  artist: string;
  /** Seconds; 0 when unknown. */
  duration: number;
}

/** Tracks that differ in length by more than this are taken for another recording (an extended mix, a live take). */
const MAX_LENGTH_GAP = 20;

/** The track among `tracks` that is the same song: matching title and performer, close in length; the best first. */
export function bestMatch(song: WantedSong, tracks: ExternalTrack[]): ExternalTrack | null {
  const q = songQuery(song);
  const title = normalizeText(q.title);
  const artist = normalizeText(q.artist);
  const [best] = tracks
    .map((t) => ({
      t,
      title: closeness(normalizeText(cleanTitle(t.title)), title),
      artist: closeness(normalizeText(t.artist), artist),
      gap: song.duration && t.duration ? Math.abs(song.duration - t.duration) : 0,
    }))
    .filter((c) => c.title > 0 && c.artist > 0 && c.gap <= MAX_LENGTH_GAP)
    .sort((a, b) => b.title + b.artist - (a.title + a.artist) || a.gap - b.gap);
  return best?.t ?? null;
}

/**
 * Looks a song up on the services in turn, those with full tracks first, and returns the first full track that is the
 * same song. A preview (Deezer, Apple Music) is the answer only when `previews` is set and no full track was found.
 * Services that fail or are not connected are skipped.
 */
export async function findSong(
  song: WantedSong,
  services: MusicProvider[],
  token: (provider: string) => Promise<string | null>,
  { previews = false, background = false }: { previews?: boolean; background?: boolean } = {},
): Promise<{ provider: string; track: ExternalTrack } | null> {
  const searchable = services.filter((p) => p.searchTracks && p.isConfigured() && (previews || p.fullTracks));
  const ordered = [...searchable.filter((p) => p.fullTracks), ...searchable.filter((p) => !p.fullTracks)];
  const q = songQuery(song);
  let fallback: { provider: string; track: ExternalTrack } | null = null;
  for (const p of ordered) {
    let found: ExternalTrack[];
    try {
      found = await p.searchTracks!(`${q.artist} ${q.title}`, { token: await token(p.id), background });
    } catch {
      continue;
    }
    const full = bestMatch(song, found.filter((t) => !t.isPreview));
    if (full) return { provider: p.id, track: full };
    if (previews && !fallback) {
      const preview = bestMatch(song, found);
      if (preview) fallback = { provider: p.id, track: preview };
    }
  }
  return fallback;
}
