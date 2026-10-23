import { useCallback, useRef, useState } from 'react';
import type { GenreFacets, TrackSort } from '../api/types';
import { useDismiss } from '../lib/useDismiss';
import { useFetch } from '../lib/useFetch';
import { Icon } from './Icon';
import { tr } from '../i18n/runtime';

/** Special genre value for tracks without a genre (matches the server's NO_GENRE). */
export const NO_GENRE = '-';

const SORT_LABELS: Record<TrackSort, string> = {
  new: 'Сначала новые',
  popular: 'Популярные',
  trending: 'В тренде',
  genre: 'По жанрам',
  title: 'По названию',
};

function SortMenu({
  value,
  options,
  labels,
  onChange,
}: {
  value: TrackSort;
  options: TrackSort[];
  labels: Partial<Record<TrackSort, string>>;
  onChange(sort: TrackSort): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const label = (s: TrackSort) => labels[s] ?? SORT_LABELS[s];

  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-text btn-small sort-button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Icon name="sort" size={18} />
        {label(value)}
        <Icon name="arrow_drop_down" size={18} />
      </button>
      {open && (
        <div className="menu-panel menu-panel-narrow menu-panel-left" role="menu">
          {options.map((s) => (
            <button
              key={s}
              className={`menu-item ${s === value ? 'menu-item-selected' : ''}`}
              role="menuitemradio"
              aria-checked={s === value}
              onClick={() => {
                onChange(s);
                close();
              }}
            >
              <span className="menu-item-check">{s === value && <Icon name="check" />}</span>
              {label(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Sort menu plus genre filter chips for a track list. `scope` names the list on the server
 * (e.g. "feed:all", "likes:anna") so the chips only offer genres that list contains;
 * pass `facets` instead for lists already loaded in full.
 */
export function GenreBar({
  scope,
  facets: given,
  genre,
  sort,
  onChange,
  sorts = ['new', 'popular', 'genre', 'title'],
  sortLabels = {},
}: {
  scope?: string;
  facets?: GenreFacets;
  genre: string | null;
  sort: TrackSort;
  onChange(patch: { genre?: string | null; sort?: TrackSort }): void;
  sorts?: TrackSort[];
  sortLabels?: Partial<Record<TrackSort, string>>;
}) {
  const fetched = useFetch<GenreFacets>(scope && !given ? `/genres?scope=${encodeURIComponent(scope)}` : null);
  const facets = given ?? fetched.data;
  const showChips = Boolean(facets && (facets.genres.length > 1 || (facets.genres.length === 1 && facets.untagged > 0) || genre));

  return (
    <div className="genre-bar">
      <SortMenu value={sort} options={sorts} labels={sortLabels} onChange={(s) => onChange({ sort: s })} />
      {showChips && facets && (
        <div className="chips chips-scroll" role="group" aria-label="Фильтр по жанру">
          <button className={`chip ${!genre ? 'chip-selected' : ''}`} aria-pressed={!genre} onClick={() => onChange({ genre: null })}>
            {!genre && <Icon name="check" size={18} />}
            Все жанры
          </button>
          {facets.genres.map((g) => {
            const selected = genre?.toLocaleLowerCase() === g.name.toLocaleLowerCase();
            return (
              <button
                key={g.name}
                className={`chip ${selected ? 'chip-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onChange({ genre: selected ? null : g.name })}
              >
                {selected && <Icon name="check" size={18} />}
                {tr(g.name)}
                <span className="chip-count">{g.count}</span>
              </button>
            );
          })}
          {facets.untagged > 0 && (
            <button
              className={`chip ${genre === NO_GENRE ? 'chip-selected' : ''}`}
              aria-pressed={genre === NO_GENRE}
              onClick={() => onChange({ genre: genre === NO_GENRE ? null : NO_GENRE })}
            >
              {genre === NO_GENRE && <Icon name="check" size={18} />}
              Без жанра
              <span className="chip-count">{facets.untagged}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Genre facets for a list that is already fully loaded (playlists). */
export function localFacets(tracks: { genre: string | null }[]): GenreFacets {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const t of tracks) {
    if (t.genre) counts.set(t.genre, (counts.get(t.genre) ?? 0) + 1);
    else untagged++;
  }
  const genres = [...counts].map(([name, count]) => ({ name, count, coverUrl: null })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
  return { genres, untagged, total: tracks.length };
}
