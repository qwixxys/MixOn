import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Service, Track } from '../api/types';
import { ImportLinkForm } from '../components/ImportPlaylist';
import { SuggestedUsers } from '../components/SuggestedUsers';
import { SyncWidget } from '../components/SyncWidget';
import { GenreBar } from '../components/GenreBar';
import { SegmentedButtons } from '../components/Material';
import { TrackList } from '../components/TrackCard';
import { TrackRow } from '../components/TrackRow';
import { Empty, ErrorState, Loading } from '../components/States';
import { STANDALONE } from '../lib/standalone';
import { useFetch } from '../lib/useFetch';
import { useListQuery, withQuery } from '../lib/useListQuery';
import { usePaged } from '../lib/usePaged';
import { useAuth } from '../store/auth';
import { DiscoverSections } from './DiscoverPage';
import { Icon } from '../components/Icon';

type FeedType = 'all' | 'releases' | 'uploads';

const FRESH_DAYS = 30;

function isFreshRelease(t: Track) {
  return Boolean(t.externalArtist && t.releasedAt && Date.now() - Date.parse(t.releasedAt) < FRESH_DAYS * 86400_000);
}

function Hero() {
  return (
    <section className="hero">
      <div className="hero-content">
        <h1>Вся новая музыка ваших артистов — в одной ленте</h1>
        <p className="body-large">
          MixOn — площадка в духе SoundCloud: загружайте свои треки, собирайте плейлисты, комментируйте прямо на волне. А
          синхронизация с SoundCloud, ВК Музыкой, Deezer, Apple Music и Jamendo сама приносит свежие релизы артистов, на которых вы
          подписаны.
        </p>
        <div className="hero-actions">
          <Link to="/register" className="btn btn-filled btn-large">
            Начать бесплатно
          </Link>
          <Link to="/discover" className="btn btn-elevated btn-large">
            Послушать, что нового
          </Link>
        </div>
      </div>
    </section>
  );
}

function HistoryWidget() {
  const { data } = useFetch<Track[]>('/me/history?limit=5');
  if (!data?.length) return null;
  return (
    <section className="side-card">
      <div className="side-card-header">
        <h3>Недавно слушали</h3>
        <Link to="/library?tab=history" className="small">
          Всё
        </Link>
      </div>
      {data.map((t) => (
        <TrackRow key={t.id} track={t} queue={data} compact />
      ))}
    </section>
  );
}

/** Bringing playlists over from elsewhere (Spotify, Deezer, …); searching is in the bar at the top. */
function ImportCard() {
  const services = useFetch<Service[]>('/services');
  const [open, setOpen] = useState(false);

  return (
    <details className="home-import" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Icon name="playlist_add" size={20} />
        <span className="home-import-title">
          Импорт плейлиста <span className="muted">из Spotify, Deezer, SoundCloud или YouTube</span>
        </span>
        <Icon name="keyboard_arrow_down" size={20} className="key-form-chevron" />
      </summary>
      {open && services.data && <ImportLinkForm services={services.data} />}
      {open && services.error && <ErrorState message={services.error} onRetry={services.reload} />}
    </details>
  );
}

function Stream() {
  const [type, setType] = useState<FeedType>('all');
  const list = useListQuery();
  const feed = usePaged<Track>(withQuery(`/feed?type=${type}`, list.qs));

  useEffect(() => {
    const onSync = () => feed.reload();
    window.addEventListener('soundfy:synced', onSync);
    return () => window.removeEventListener('soundfy:synced', onSync);
  }, [feed.reload]);

  return (
    <div className="with-sidebar">
      <div className="content">
        <ImportCard />
        <div className="page-header">
          <h1>Лента</h1>
          {/* Without uploads the standalone feed holds only releases. */}
          {!STANDALONE && (
            <SegmentedButtons
              label="Что показывать"
              options={[
                { id: 'all', label: 'Всё' },
                { id: 'releases', label: 'Релизы' },
                { id: 'uploads', label: 'Загрузки' },
              ]}
              value={type}
              onChange={setType}
            />
          )}
        </div>
        <GenreBar scope={`feed:${type}`} genre={list.genre} sort={list.sort} onChange={list.update} />
        {feed.error && <ErrorState message={feed.error} onRetry={feed.reload} />}
        {!feed.loading && !feed.error && !feed.items.length && (
          <Empty icon={<Icon name="hub" size={32} />} title="Лента пока пуста">
            <p>
              Найдите любимых артистов поиском вверху и подпишитесь — их новые треки из SoundCloud, ВК Музыки, YouTube, Deezer и других
              сервисов будут появляться здесь.
              {!STANDALONE && (
                <>
                  {' '}
                  Или подпишитесь на авторов в <Link to="/discover">«Обзоре»</Link>.
                </>
              )}
            </p>
            <div className="row-gap">
              <Link to="/sync" className="btn btn-filled">
                <Icon name="hub" size={18} /> Подключить сервисы
              </Link>
              <Link to="/discover" className="btn btn-outlined">
                <Icon name="explore" size={18} /> Обзор
              </Link>
            </div>
          </Empty>
        )}
        <TrackList
          tracks={feed.items}
          groupByGenre={list.sort === 'genre'}
          reason={(t) => (isFreshRelease(t) ? 'новый релиз' : undefined)}
        />
        {feed.loading && <Loading />}
        {feed.hasMore && !feed.loading && (
          <button className="btn btn-outlined btn-block" onClick={feed.loadMore}>
            Показать ещё
          </button>
        )}
      </div>
      <aside className="sidebar">
        <SyncWidget />
        <SuggestedUsers />
        <HistoryWidget />
      </aside>
    </div>
  );
}

export function HomePage() {
  const user = useAuth((s) => s.user);
  if (user) {
    return (
      <div className="page">
        <Stream />
      </div>
    );
  }
  return (
    <>
      <Hero />
      <div className="page">
        <DiscoverSections />
      </div>
    </>
  );
}
