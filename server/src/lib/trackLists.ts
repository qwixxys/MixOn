import type { DB } from '../db/index.js';
import { badRequest, notFound, unauthorized } from './errors.js';
import { normalizeGenre } from './genres.js';
import { parsePaging, queryTracks, type TrackDTO } from './tracks.js';

/**
 * A "scope" is one of the app's track lists (a feed, someone's likes…). Every list shares the
 * same `?genre=` filter, `?sort=` orders and genre facets, so they are defined once here.
 */
export interface Scope {
  join: string;
  where: string;
  params: Record<string, unknown>;
  /** The list's natural order, used for `sort=new` and as a tie-breaker. */
  order: string;
}

export const SORTS = ['new', 'popular', 'trending', 'genre', 'title'] as const;
export type Sort = (typeof SORTS)[number];

/** `genre=-` selects tracks without a genre. */
export const NO_GENRE = '-';

const NEWEST = 'COALESCE(t.released_at, t.created_at) DESC, t.id DESC';

function userId(db: DB, username: string): number {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  if (!row) throw notFound('Пользователь не найден');
  return row.id;
}

export function resolveScope(db: DB, scope: string, viewer?: number): Scope {
  const sep = scope.indexOf(':');
  const kind = sep === -1 ? scope : scope.slice(0, sep);
  const arg = sep === -1 ? '' : scope.slice(sep + 1);
  const me = () => {
    if (!viewer) throw unauthorized();
    return viewer;
  };

  switch (kind) {
    case 'all':
      return { join: '', where: '1 = 1', params: {}, order: NEWEST };
    case 'source':
      if (arg === 'local') return { join: '', where: `t.source = 'local'`, params: {}, order: NEWEST };
      if (arg === 'external') return { join: '', where: `t.source <> 'local'`, params: {}, order: NEWEST };
      return { join: '', where: 't.source = @scopeSource', params: { scopeSource: arg }, order: NEWEST };
    case 'feed': {
      // Uploads of people the viewer follows and releases of artists they subscribed to.
      const uploads = 't.user_id IN (SELECT followee_id FROM follows WHERE follower_id = @scopeUser)';
      const releases = 't.external_artist_id IN (SELECT external_artist_id FROM subscriptions WHERE user_id = @scopeUser)';
      const where = arg === 'uploads' ? uploads : arg === 'releases' ? releases : `${uploads} OR ${releases}`;
      return { join: '', where, params: { scopeUser: me() }, order: NEWEST };
    }
    case 'uploads':
      return { join: '', where: 't.user_id = @scopeUser', params: { scopeUser: userId(db, arg) }, order: 't.created_at DESC, t.id DESC' };
    case 'likes':
      return {
        join: 'JOIN likes lk ON lk.track_id = t.id AND lk.user_id = @scopeUser',
        where: '1 = 1',
        params: { scopeUser: userId(db, arg) },
        order: 'lk.created_at DESC',
      };
    case 'history':
      return {
        join: `JOIN (SELECT track_id, MAX(id) AS last_play FROM plays WHERE user_id = @scopeUser GROUP BY track_id) h
               ON h.track_id = t.id`,
        where: '1 = 1',
        params: { scopeUser: me() },
        order: 'h.last_play DESC',
      };
    case 'artist': {
      const id = Number(arg);
      if (!Number.isInteger(id) || id <= 0) throw badRequest('Некорректный идентификатор артиста');
      return { join: '', where: 't.external_artist_id = @scopeArtist', params: { scopeArtist: id }, order: 't.released_at DESC, t.id DESC' };
    }
    default:
      throw badRequest(`Неизвестный список: ${kind}`);
  }
}

export interface ListOptions {
  /** Normalised genre, or NO_GENRE for untagged tracks. */
  genre: string | null;
  sort: Sort;
}

export function listOptions(query: Record<string, unknown>, defaultSort: Sort = 'new'): ListOptions {
  const raw = typeof query.genre === 'string' ? query.genre.trim() : '';
  const sort = SORTS.includes(query.sort as Sort) ? (query.sort as Sort) : defaultSort;
  return { genre: raw === NO_GENRE ? NO_GENRE : normalizeGenre(raw), sort };
}

function orderBy(sort: Sort, natural: string, params: Record<string, unknown>): string {
  switch (sort) {
    case 'popular':
      return `t.play_count DESC, ${natural}`;
    case 'trending':
      params.weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      return `(SELECT COUNT(*) FROM plays p WHERE p.track_id = t.id AND p.created_at >= @weekAgo) DESC, t.play_count DESC, ${natural}`;
    case 'genre':
      // Grouped by genre (untagged last), each group in the list's natural order.
      return `(t.genre IS NULL), t.genre COLLATE NOCASE, ${natural}`;
    case 'title':
      return `t.title COLLATE NOCASE, t.id`;
    default:
      return natural;
  }
}

export function listTracks(
  db: DB,
  scope: Scope,
  options: ListOptions,
  query: Record<string, unknown>,
  viewer?: number,
  defaultLimit = 20,
): TrackDTO[] {
  const { limit, offset } = parsePaging(query, defaultLimit, Math.max(100, defaultLimit));
  const params: Record<string, unknown> = { ...scope.params, limit, offset };
  const where = [`(${scope.where})`];
  if (options.genre === NO_GENRE) where.push('t.genre IS NULL');
  else if (options.genre) {
    where.push('t.genre = @genre COLLATE NOCASE');
    params.genre = options.genre;
  }
  const order = orderBy(options.sort, scope.order, params);
  return queryTracks(db, `${scope.join} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT @limit OFFSET @offset`, params, viewer);
}

export interface GenreFacet {
  name: string;
  count: number;
  /** Artwork of the most played track of the genre, for genre cards. */
  coverUrl: string | null;
}

/** Genres present in a list with their track counts, most common first. */
export function genreFacets(db: DB, scope: Scope): { genres: GenreFacet[]; untagged: number; total: number } {
  const rows = db
    .prepare(
      `SELECT t.genre AS name, COUNT(*) AS count,
         (SELECT COALESCE('/media/covers/' || c.cover_path, c.cover_url) FROM tracks c
          WHERE c.genre = t.genre COLLATE NOCASE AND (c.cover_path IS NOT NULL OR c.cover_url IS NOT NULL)
          ORDER BY c.play_count DESC, c.id DESC LIMIT 1) AS coverUrl
       FROM tracks t ${scope.join}
       WHERE (${scope.where})
       GROUP BY t.genre COLLATE NOCASE
       ORDER BY count DESC, t.genre COLLATE NOCASE`,
    )
    .all(scope.params) as (Omit<GenreFacet, 'name'> & { name: string | null })[];
  const genres = rows.filter((r): r is GenreFacet => r.name !== null);
  const untagged = rows.find((r) => r.name === null)?.count ?? 0;
  return { genres, untagged, total: rows.reduce((sum, r) => sum + r.count, 0) };
}
