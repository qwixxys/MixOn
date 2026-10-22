import type { DB } from '../db/index.js';
import { syntheticWaveform } from './waveform.js';

export interface UserSummary {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface TrackDTO {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  description: string;
  genre: string | null;
  duration: number;
  coverUrl: string | null;
  waveform: number[];
  source: string;
  externalUrl: string | null;
  isPreview: boolean;
  playCount: number;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  releasedAt: string | null;
  createdAt: string;
  uploader: UserSummary | null;
  externalArtist: { id: number; provider: string; name: string; imageUrl: string | null } | null;
}

export interface TrackRow {
  id: number;
  user_id: number | null;
  external_artist_id: number | null;
  source: string;
  external_id: string | null;
  title: string;
  artist: string;
  album: string | null;
  description: string;
  genre: string | null;
  duration: number;
  audio_path: string | null;
  audio_mime: string | null;
  stream_url: string | null;
  cover_path: string | null;
  cover_url: string | null;
  external_url: string | null;
  is_preview: number;
  waveform: string | null;
  extra: string | null;
  play_count: number;
  released_at: string | null;
  created_at: string;
  genius_id: number | null;
  genius_checked_at: string | null;
  genius_manual: number;
}

interface JoinedTrackRow extends TrackRow {
  u_username: string | null;
  u_display_name: string | null;
  u_avatar_path: string | null;
  ea_provider: string | null;
  ea_name: string | null;
  ea_image_url: string | null;
  like_count: number;
  comment_count: number;
  liked: number;
}

export const coverUrl = (path: string | null, url: string | null) => (path ? `/media/covers/${path}` : url);
export const avatarUrl = (path: string | null) => (path ? `/media/avatars/${path}` : null);

/**
 * Base SELECT for track lists. Callers append WHERE/ORDER/LIMIT and must bind `@viewer`
 * (the current user id, or 0 for guests) — `queryTracks` does that for them.
 */
export const TRACK_SELECT = `
  SELECT t.*,
    u.username AS u_username, u.display_name AS u_display_name, u.avatar_path AS u_avatar_path,
    ea.provider AS ea_provider, ea.name AS ea_name, ea.image_url AS ea_image_url,
    (SELECT COUNT(*) FROM likes l WHERE l.track_id = t.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.track_id = t.id) AS comment_count,
    EXISTS (SELECT 1 FROM likes l2 WHERE l2.track_id = t.id AND l2.user_id = @viewer) AS liked
  FROM tracks t
  LEFT JOIN users u ON u.id = t.user_id
  LEFT JOIN external_artists ea ON ea.id = t.external_artist_id`;

function parseWaveform(row: TrackRow): number[] {
  if (row.waveform) {
    try {
      const parsed = JSON.parse(row.waveform);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to synthetic
    }
  }
  return syntheticWaveform(`${row.source}:${row.external_id ?? row.id}`);
}

export function toTrackDTO(row: JoinedTrackRow): TrackDTO {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    description: row.description,
    genre: row.genre,
    duration: row.duration,
    coverUrl: coverUrl(row.cover_path, row.cover_url),
    waveform: parseWaveform(row),
    source: row.source,
    externalUrl: row.external_url,
    isPreview: Boolean(row.is_preview),
    playCount: row.play_count,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    liked: Boolean(row.liked),
    releasedAt: row.released_at,
    createdAt: row.created_at,
    uploader:
      row.user_id && row.u_username
        ? {
            id: row.user_id,
            username: row.u_username,
            displayName: row.u_display_name ?? row.u_username,
            avatarUrl: avatarUrl(row.u_avatar_path),
          }
        : null,
    externalArtist:
      row.external_artist_id && row.ea_provider
        ? {
            id: row.external_artist_id,
            provider: row.ea_provider,
            name: row.ea_name ?? row.artist,
            imageUrl: row.ea_image_url,
          }
        : null,
  };
}

export function queryTracks(
  db: DB,
  tail: string,
  params: Record<string, unknown> = {},
  viewer?: number | null,
): TrackDTO[] {
  const rows = db.prepare(`${TRACK_SELECT} ${tail}`).all({ ...params, viewer: viewer ?? 0 }) as JoinedTrackRow[];
  return rows.map(toTrackDTO);
}

export function getTrack(db: DB, id: number, viewer?: number | null): TrackDTO | null {
  return queryTracks(db, 'WHERE t.id = @id', { id }, viewer)[0] ?? null;
}

export function getTrackRow(db: DB, id: number): TrackRow | undefined {
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined;
}

export function parsePaging(query: Record<string, unknown>, defaultLimit = 20, maxLimit = 100) {
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || defaultLimit));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit, offset };
}
