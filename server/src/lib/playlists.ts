import type { DB } from '../db/index.js';
import { avatarUrl, coverUrl, type UserSummary } from './tracks.js';

export interface PlaylistSummary {
  id: number;
  title: string;
  description: string;
  isPublic: boolean;
  trackCount: number;
  duration: number;
  coverUrl: string | null;
  owner: UserSummary;
  createdAt: string;
  updatedAt: string;
}

interface PlaylistRow {
  id: number;
  user_id: number;
  title: string;
  description: string;
  is_public: number;
  created_at: string;
  updated_at: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  track_count: number;
  duration: number | null;
  cover_path: string | null;
  cover_url: string | null;
}

const PLAYLIST_SELECT = `
  SELECT p.*, u.username, u.display_name, u.avatar_path,
    (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count,
    (SELECT SUM(t.duration) FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = p.id) AS duration,
    first.cover_path, first.cover_url
  FROM playlists p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN tracks first ON first.id = (
    SELECT pt.track_id FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = p.id AND (t.cover_path IS NOT NULL OR t.cover_url IS NOT NULL)
    ORDER BY pt.position LIMIT 1
  )`;

export function queryPlaylists(db: DB, tail: string, params: Record<string, unknown> = {}): PlaylistSummary[] {
  const rows = db.prepare(`${PLAYLIST_SELECT} ${tail}`).all(params) as PlaylistRow[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    isPublic: Boolean(row.is_public),
    trackCount: row.track_count,
    duration: row.duration ?? 0,
    coverUrl: coverUrl(row.cover_path, row.cover_url),
    owner: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: avatarUrl(row.avatar_path),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
