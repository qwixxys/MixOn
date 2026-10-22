import { Compass, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Track } from '../api/types';
import { SuggestedUsers } from '../components/SuggestedUsers';
import { SyncWidget } from '../components/SyncWidget';
import { Tabs } from '../components/Tabs';
import { TrackList } from '../components/TrackCard';
import { TrackRow } from '../components/TrackRow';
import { Empty, ErrorState, Loading } from '../components/States';
import { useFetch } from '../lib/useFetch';
import { usePaged } from '../lib/usePaged';
import { useAuth } from '../store/auth';
import { DiscoverSections } from './DiscoverPage';

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
        <p>
          soundFy — площадка в духе SoundCloud: загружайте свои треки, собирайте плейлисты, комментируйте прямо на волне. А
          синхронизация с ВК Музыкой, Deezer, Apple Music и Jamendo сама приносит свежие релизы артистов, на которых вы подписаны.
        </p>
        <div className="hero-actions">
          <Link to="/register" className="btn btn-primary btn-large">
            Начать бесплатно
          </Link>
          <Link to="/discover" className="btn btn-light btn-large">
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

function Stream() {
  const [type, setType] = useState<FeedType>('all');
  const feed = usePaged<Track>(`/feed?type=${type}`);

  useEffect(() => {
    const onSync = () => feed.reload();
    window.addEventListener('soundfy:synced', onSync);
    return () => window.removeEventListener('soundfy:synced', onSync);
  }, [feed.reload]);

  return (
    <div className="with-sidebar">
      <div className="content">
        <div className="page-header">
          <h1>Лента</h1>
          <Tabs
            tabs={[
              { id: 'all', label: 'Всё' },
              { id: 'releases', label: 'Релизы артистов' },
              { id: 'uploads', label: 'Загрузки подписок' },
            ]}
            value={type}
            onChange={setType}
          />
        </div>
        {feed.error && <ErrorState message={feed.error} onRetry={feed.reload} />}
        {!feed.loading && !feed.error && !feed.items.length && (
          <Empty icon={<Radio size={36} />} title="Лента пока пуста">
            <p>
              Подпишитесь на любимых артистов в разделе <Link to="/sync">«Сервисы»</Link> — их новые треки из ВК Музыки, Deezer и
              других сервисов будут появляться здесь. Или подпишитесь на авторов в <Link to="/discover">«Обзоре»</Link>.
            </p>
            <div className="row-gap">
              <Link to="/sync" className="btn btn-primary">
                <Radio size={16} /> Найти артистов
              </Link>
              <Link to="/discover" className="btn btn-outline">
                <Compass size={16} /> Обзор
              </Link>
            </div>
          </Empty>
        )}
        <TrackList tracks={feed.items} reason={(t) => (isFreshRelease(t) ? 'новый релиз' : undefined)} />
        {feed.loading && <Loading />}
        {feed.hasMore && !feed.loading && (
          <button className="btn btn-outline btn-block" onClick={feed.loadMore}>
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
