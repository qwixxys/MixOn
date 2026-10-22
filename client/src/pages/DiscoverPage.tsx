import { Link, useSearchParams } from 'react-router';
import type { DiscoverData, GenreFacets } from '../api/types';
import { PlaylistGrid } from '../components/PlaylistTile';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackRow } from '../components/TrackRow';
import { TrackGrid } from '../components/TrackTile';
import { FilteredTrackList } from '../components/FilteredTrackList';
import { NO_GENRE } from '../components/GenreBar';
import { useFetch } from '../lib/useFetch';
import { plural } from '../lib/format';
import { gradientFor } from '../lib/gradient';
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

/** Genre cards: a tonal colour per genre, with the artwork of its most played track. */
function GenreCards() {
  const { data } = useFetch<GenreFacets>('/genres?scope=all');
  if (!data?.genres.length) return null;
  return (
    <Section title="Жанры">
      <div className="genre-cards">
        {data.genres.slice(0, 18).map((g) => (
          <Link key={g.name} to={`/discover?genre=${encodeURIComponent(g.name)}`} className="genre-card" style={{ background: gradientFor(g.name) }}>
            {g.coverUrl && <img src={g.coverUrl} alt="" loading="lazy" />}
            <span className="genre-card-name">{g.name}</span>
            <span className="genre-card-count">
              {g.count} {plural(g.count, ['трек', 'трека', 'треков'])}
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

export function DiscoverPage() {
  const [params] = useSearchParams();
  const genre = params.get('genre');
  const source = params.get('source');
  const sort = params.get('sort');
  const filtered = Boolean(genre || source || sort);
  const scope = source === 'local' || source === 'external' ? `source:${source}` : 'all';
  const title = genre
    ? genre === NO_GENRE
      ? 'Без жанра'
      : genre
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
        {filtered && (
          <Link to="/discover" className="btn btn-text">
            <Icon name="explore" size={18} /> Весь обзор
          </Link>
        )}
      </div>
      {filtered ? (
        <FilteredTrackList
          path={`/tracks${source ? `?source=${encodeURIComponent(source)}` : ''}`}
          scope={scope}
          sorts={['new', 'trending', 'popular', 'genre', 'title']}
          empty={<Empty title="Ничего не найдено" />}
        />
      ) : (
        <>
          <GenreCards />
          <DiscoverSections />
        </>
      )}
    </div>
  );
}
