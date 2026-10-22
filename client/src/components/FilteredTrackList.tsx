import type { ReactNode } from 'react';
import type { Track, TrackSort } from '../api/types';
import { useListQuery, withQuery } from '../lib/useListQuery';
import { usePaged } from '../lib/usePaged';
import { GenreBar } from './GenreBar';
import { Empty, ErrorState, Loading } from './States';
import { TrackList } from './TrackCard';

/** A paginated track list with the genre filter and sort menu. Options live in the URL (?genre=&sort=). */
export function FilteredTrackList({
  path,
  scope,
  empty,
  sorts,
  sortLabels,
  defaultSort = 'new',
  pageSize,
}: {
  /** API path of the list. */
  path: string;
  /** The same list as a /genres scope, for the genre chips. */
  scope: string;
  empty: ReactNode;
  sorts?: TrackSort[];
  sortLabels?: Partial<Record<TrackSort, string>>;
  defaultSort?: TrackSort;
  pageSize?: number;
}) {
  const query = useListQuery(defaultSort);
  const qs = `${query.qs}${query.sort === defaultSort && defaultSort !== 'new' ? `&sort=${defaultSort}` : ''}`;
  const list = usePaged<Track>(withQuery(path, qs), pageSize);

  return (
    <>
      <GenreBar scope={scope} genre={query.genre} sort={query.sort} onChange={query.update} sorts={sorts} sortLabels={sortLabels} />
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      {!list.loading && !list.error && !list.items.length && (query.genre ? <Empty title="В этом жанре треков нет" /> : empty)}
      <TrackList tracks={list.items} groupByGenre={query.sort === 'genre'} />
      {list.loading && <Loading />}
      {list.hasMore && !list.loading && (
        <button className="btn btn-outlined btn-block" onClick={list.loadMore}>
          Показать ещё
        </button>
      )}
    </>
  );
}
