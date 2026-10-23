import { Router } from 'express';
import type { AppContext } from '../context.js';
import { queryPlaylists } from '../lib/playlists.js';
import { genreFacets, listOptions, listTracks, resolveScope } from '../lib/trackLists.js';
import { avatarUrl, queryTracks } from '../lib/tracks.js';
import { requireUser } from '../middleware/auth.js';

export function discoverRoutes(ctx: AppContext) {
  const r = Router();
  const { db } = ctx;

  /** The user's stream: uploads of people they follow and releases of artists they subscribed to. */
  r.get('/feed', (req, res) => {
    const me = requireUser(req);
    const type = ['uploads', 'releases'].includes(String(req.query.type)) ? String(req.query.type) : 'all';
    res.json(listTracks(db, resolveScope(db, `feed:${type}`, me), listOptions(req.query), req.query, me));
  });

  /** Genres present in a track list (?scope=all|feed:all|likes:<user>|uploads:<user>|history|artist:<id>|source:<s>). */
  r.get('/genres', (req, res) => {
    const scope = typeof req.query.scope === 'string' && req.query.scope ? req.query.scope : 'all';
    res.json(genreFacets(db, resolveScope(db, scope, req.userId)));
  });

  r.get('/discover', (req, res) => {
    const viewer = req.userId;
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    res.json({
      // Only what people have played: tracks found by the search must not look popular.
      trending: queryTracks(
        db,
        `WHERE t.play_count > 0
         ORDER BY (SELECT COUNT(*) FROM plays p WHERE p.track_id = t.id AND p.created_at >= @weekAgo) DESC,
           t.play_count DESC, t.id DESC LIMIT 10`,
        { weekAgo },
        viewer,
      ),
      newReleases: queryTracks(
        db,
        // Artists someone follows, not every artist whose page was opened from a search.
        `WHERE t.source <> 'local' AND t.external_artist_id IN (SELECT external_artist_id FROM subscriptions)
         ORDER BY t.released_at DESC, t.id DESC LIMIT 12`,
        {},
        viewer,
      ),
      freshUploads: queryTracks(db, `WHERE t.source = 'local' ORDER BY t.created_at DESC LIMIT 10`, {}, viewer),
      playlists: queryPlaylists(
        db,
        `WHERE p.is_public = 1 AND EXISTS (SELECT 1 FROM playlist_tracks pt WHERE pt.playlist_id = p.id)
         ORDER BY p.updated_at DESC LIMIT 8`,
      ),
    });
  });

  r.get('/search', (req, res) => {
    const q = String(req.query.q ?? '').trim().toLocaleLowerCase();
    if (!q) return res.json({ tracks: [], users: [], playlists: [], artists: [] });
    const params = { q };
    const tracks = queryTracks(
      db,
      `WHERE instr(ulower(t.title), @q) OR instr(ulower(t.artist), @q) OR instr(ulower(COALESCE(t.album, '')), @q)
         OR instr(ulower(COALESCE(t.genre, '')), @q)
       ORDER BY (ulower(t.title) = @q OR ulower(t.artist) = @q) DESC, t.play_count DESC, t.id DESC LIMIT 50`,
      params,
      req.userId,
    );
    const users = (
      db
        .prepare(
          `SELECT id, username, display_name, avatar_path,
             (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
           FROM users u WHERE instr(ulower(username), @q) OR instr(ulower(display_name), @q)
           ORDER BY followers DESC LIMIT 20`,
        )
        .all(params) as { id: number; username: string; display_name: string; avatar_path: string | null; followers: number }[]
    ).map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarUrl: avatarUrl(u.avatar_path),
      followers: u.followers,
    }));
    const playlists = queryPlaylists(db, 'WHERE p.is_public = 1 AND instr(ulower(p.title), @q) LIMIT 20', params);
    const artists = db
      .prepare(
        `SELECT ea.id, ea.provider, ea.name, ea.image_url AS imageUrl,
           (SELECT COUNT(*) FROM tracks t WHERE t.external_artist_id = ea.id) AS trackCount
         FROM external_artists ea WHERE instr(ulower(ea.name), @q) LIMIT 20`,
      )
      .all(params);
    res.json({ tracks, users, playlists, artists });
  });

  return r;
}
