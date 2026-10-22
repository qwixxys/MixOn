import { useSearchParams } from 'react-router';
import type { TrackSort } from '../api/types';

const SORTS: TrackSort[] = ['new', 'popular', 'trending', 'genre', 'title'];

/** Genre filter and sort order of a track list, kept in the URL so the view can be shared. */
export function useListQuery(defaultSort: TrackSort = 'new') {
  const [params, setParams] = useSearchParams();
  const genre = params.get('genre');
  const sort = SORTS.includes(params.get('sort') as TrackSort) ? (params.get('sort') as TrackSort) : defaultSort;

  const update = (patch: { genre?: string | null; sort?: TrackSort }) =>
    setParams(
      (p) => {
        if ('genre' in patch) {
          if (patch.genre) p.set('genre', patch.genre);
          else p.delete('genre');
        }
        if (patch.sort) {
          if (patch.sort === defaultSort) p.delete('sort');
          else p.set('sort', patch.sort);
        }
        return p;
      },
      { replace: true },
    );

  /** Query string for the list endpoint, starting with "&". */
  const qs = `${genre ? `&genre=${encodeURIComponent(genre)}` : ''}${sort !== 'new' ? `&sort=${sort}` : ''}`;
  return { genre, sort, update, qs };
}

/** Appends list options to an API path that may already have a query string. */
export function withQuery(path: string, qs: string) {
  if (!qs) return path;
  return path.includes('?') ? `${path}${qs}` : `${path}?${qs.slice(1)}`;
}
