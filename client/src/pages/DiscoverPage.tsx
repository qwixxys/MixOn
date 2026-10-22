import { Link, useSearchParams } from 'react-router';
import type { DiscoverData, Track } from '../api/types';
import { PlaylistGrid } from '../components/PlaylistTile';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackCard';
import { TrackRow } from '../components/TrackRow';
import { TrackGrid } from '../components/TrackTile';
import { Tabs } from '../components/Tabs';
import { useFetch } from '../lib/useFetch';
import { usePaged } from '../lib/usePaged';
import { Icon } from '../components/Icon';

function Section({ title, link, children }: { title: string; link?: { to: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-header">
        <h2>{title}</h2>
        {link && (
          <Link to={link.to} className="small">
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function DiscoverSections() {
  const { data, error, loading, reload } = useFetch<DiscoverData>('/discover');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? 'Ошибка'} onRetry={reload} />;
  const empty = !data.trending.length && !data.newReleases.length && !data.freshUploads.length;
  if (empty) {
    return (
      <Empty icon={<Icon name="music_note" size={32} />} title="Здесь пока тихо">
        <p>Загрузите первый трек или подпишитесь на артистов — и музыка появится.</p>
        <div className="row-gap">
          <Link to="/upload" className="btn btn-filled">
            <Icon name="upload" size={18} /> Загрузить трек
          </Link>
          <Link to="/sync" className="btn btn-outlined">
            Подписаться на артистов
          </Link>
        </div>
      </Empty>
    );
  }
  const trending = data.trending.filter((t) => t.playCount > 0);
  return (
    <>
      {data.newReleases.length > 0 && (
        <Section title="Новые релизы с музыкальных сервисов" link={{ to: '/discover?source=external', label: 'Все релизы' }}>
          <TrackGrid tracks={data.newReleases} />
        </Section>
      )}
      {trending.length > 0 && (
        <Section title="В тренде за неделю" link={{ to: '/discover?sort=trending', label: 'Весь чарт' }}>
          <div className="chart">
            {trending.map((t, i) => (
              <TrackRow key={t.id} track={t} queue={trending} index={i} />
            ))}
          </div>
        </Section>
      )}
      {data.freshUploads.length > 0 && (
        <Section title="Свежие загрузки авторов" link={{ to: '/discover?source=local', label: 'Все загрузки' }}>
          <TrackGrid tracks={data.freshUploads} />
        </Section>
      )}
      {data.playlists.length > 0 && (
        <Section title="Плейлисты">
          <PlaylistGrid playlists={data.playlists} />
        </Section>
      )}
    </>
  );
}

function Genres({ active }: { active: string | null }) {
  const { data } = useFetch<{ name: string; count: number }[]>('/tracks/genres');
  if (!data?.length) return null;
  return (
    <div className="chips">
      <Link to="/discover" className={`chip ${!active ? 'chip-selected' : ''}`}>
        {!active && <Icon name="check" size={18} />}
        Все жанры
      </Link>
      {data.map((g) => {
        const selected = active?.toLowerCase() === g.name.toLowerCase();
        return (
          <Link key={g.name} to={`/discover?genre=${encodeURIComponent(g.name)}`} className={`chip ${selected ? 'chip-selected' : ''}`}>
            {selected && <Icon name="check" size={18} />}
            {g.name}
          </Link>
        );
      })}
    </div>
  );
}

const SORTS = [
  { id: 'new', label: 'Новые' },
  { id: 'trending', label: 'В тренде' },
  { id: 'popular', label: 'Популярные' },
] as const;
type Sort = (typeof SORTS)[number]['id'];

function FilteredTracks({ genre, source, sort }: { genre: string | null; source: string | null; sort: Sort }) {
  const [, setParams] = useSearchParams();
  const qs = new URLSearchParams({ sort });
  if (genre) qs.set('genre', genre);
  if (source) qs.set('source', source);
  const list = usePaged<Track>(`/tracks?${qs}`);

  return (
    <>
      <Tabs
        tabs={SORTS.map((s) => ({ id: s.id, label: s.label }))}
        value={sort}
        onChange={(id) =>
          setParams((p) => {
            p.set('sort', id);
            return p;
          })
        }
      />
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      {!list.loading && !list.items.length && <Empty title="Ничего не найдено" />}
      <TrackList tracks={list.items} />
      {list.loading && <Loading />}
      {list.hasMore && !list.loading && (
        <button className="btn btn-outlined btn-block" onClick={list.loadMore}>
          Показать ещё
        </button>
      )}
    </>
  );
}

export function DiscoverPage() {
  const [params] = useSearchParams();
  const genre = params.get('genre');
  const source = params.get('source');
  const sort = (SORTS.find((s) => s.id === params.get('sort'))?.id ?? (genre || source ? 'new' : null)) as Sort | null;
  const title = genre
    ? `#${genre}`
    : source === 'external'
      ? 'Релизы с сервисов'
      : source === 'local'
        ? 'Загрузки авторов'
        : sort === 'trending'
          ? 'Чарт'
          : 'Обзор';

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <Genres active={genre} />
      {sort ? <FilteredTracks genre={genre} source={source} sort={sort} /> : <DiscoverSections />}
    </div>
  );
}
