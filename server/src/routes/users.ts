import { Router } from 'express';
import type { AppContext } from '../context.js';
import { badRequest, notFound } from '../lib/errors.js';
import { queryPlaylists } from '../lib/playlists.js';
import { avatarUrl, parsePaging, queryTracks } from '../lib/tracks.js';
import { requireUser } from '../middleware/auth.js';
import type { UserRow } from './auth.js';

export function userRoutes(ctx: AppContext) {
  const r = Router();
  const { db } = ctx;

  const findUser = (username: string) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!user) throw notFound('Пользователь не найден');
    return user;
  };

  r.get('/suggested', (req, res) => {
    const viewer = req.userId ?? 0;
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_path,
           (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers,
           (SELECT COUNT(*) FROM tracks t WHERE t.user_id = u.id) AS tracks
         FROM users u
         WHERE u.id <> @viewer AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = @viewer AND f.followee_id = u.id)
           AND EXISTS (SELECT 1 FROM tracks t WHERE t.user_id = u.id)
         ORDER BY followers DESC, tracks DESC LIMIT 5`,
      )
      .all({ viewer }) as {
      id: number;
      username: string;
      display_name: string;
      avatar_path: string | null;
      followers: number;
      tracks: number;
    }[];
    res.json(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: avatarUrl(u.avatar_path),
        followers: u.followers,
        tracks: u.tracks,
      })),
    );
  });

  r.get('/:username', (req, res) => {
    const user = findUser(req.params.username);
    const stats = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM follows WHERE followee_id = @id) AS followers,
           (SELECT COUNT(*) FROM follows WHERE follower_id = @id) AS following,
           (SELECT COUNT(*) FROM tracks WHERE user_id = @id) AS tracks,
           (SELECT COUNT(*) FROM likes WHERE user_id = @id) AS likes,
           EXISTS (SELECT 1 FROM follows WHERE follower_id = @viewer AND followee_id = @id) AS is_following`,
      )
      .get({ id: user.id, viewer: req.userId ?? 0 }) as Record<string, number>;
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      bio: user.bio,
      avatarUrl: avatarUrl(user.avatar_path),
      createdAt: user.created_at,
      followers: stats.followers,
      following: stats.following,
      trackCount: stats.tracks,
      likeCount: stats.likes,
      isFollowing: Boolean(stats.is_following),
      isMe: req.userId === user.id,
    });
  });

  r.get('/:username/tracks', (req, res) => {
    const user = findUser(req.params.username);
    const { limit, offset } = parsePaging(req.query);
    res.json(
      queryTracks(
        db,
        'WHERE t.user_id = @id ORDER BY t.created_at DESC LIMIT @limit OFFSET @offset',
        { id: user.id, limit, offset },
        req.userId,
      ),
    );
  });

  r.get('/:username/likes', (req, res) => {
    const user = findUser(req.params.username);
    const { limit, offset } = parsePaging(req.query);
    res.json(
      queryTracks(
        db,
        `JOIN likes lk ON lk.track_id = t.id AND lk.user_id = @id
         ORDER BY lk.created_at DESC LIMIT @limit OFFSET @offset`,
        { id: user.id, limit, offset },
        req.userId,
      ),
    );
  });

  r.get('/:username/playlists', (req, res) => {
    const user = findUser(req.params.username);
    const own = req.userId === user.id;
    res.json(
      queryPlaylists(db, `WHERE p.user_id = @id ${own ? '' : 'AND p.is_public = 1'} ORDER BY p.updated_at DESC`, {
        id: user.id,
      }),
    );
  });

  r.post('/:username/follow', (req, res) => {
    const me = requireUser(req);
    const user = findUser(req.params.username);
    if (user.id === me) throw badRequest('Нельзя подписаться на себя');
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').run(me, user.id);
    res.json({ following: true });
  });

  r.delete('/:username/follow', (req, res) => {
    const me = requireUser(req);
    const user = findUser(req.params.username);
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(me, user.id);
    res.json({ following: false });
  });

  return r;
}
