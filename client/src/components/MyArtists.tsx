import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { Artist, SyncResult, SyncSummary } from '../api/types';
import { plural, timeAgo } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toasts';
import { Avatar } from './Cover';
import { Icon } from './Icon';
import { ServiceBadge } from './ServiceBadge';
import { Empty, ErrorState, Loading } from './States';
import { runSync } from './SyncWidget';

/** The artists the listener follows: check them for new releases or unfollow. */
export function MyArtists() {
  const { data, loading, error, reload, setData } = useFetch<Artist[]>('/subscriptions');
  const [syncing, setSyncing] = useState<number | 'all' | null>(null);

  // Following someone elsewhere in the app shows up here at once.
  useEffect(() => {
    window.addEventListener('soundfy:subscriptions', reload);
    return () => window.removeEventListener('soundfy:subscriptions', reload);
  }, [reload]);

  const syncOne = async (a: Artist) => {
    setSyncing(a.id);
    try {
      const r = await api<SyncResult>(`/artists/${a.id}/sync`, { method: 'POST' });
      toast.success(
        `${a.name}: ${r.newTracks ? `${r.newTracks} ${plural(r.newTracks, ['новый трек', 'новых трека', 'новых треков'])}` : 'новых треков нет'}`,
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setSyncing(null);
      reload();
    }
  };

  const syncAll = async () => {
    setSyncing('all');
    const summary: SyncSummary | null = await runSync();
    setSyncing(null);
    if (summary) reload();
  };

  const unsubscribe = async (a: Artist) => {
    try {
      await api(`/subscriptions/${a.id}`, { method: 'DELETE' });
      setData((d) => d?.filter((x) => x.id !== a.id) ?? null);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <section className="section">
      <div className="section-header">
        <span className="muted">
          {data?.length ? `${data.length} ${plural(data.length, ['артист', 'артиста', 'артистов'])} — их новые треки приходят в ленту и уведомления` : ''}
        </span>
        {data && data.length > 0 && (
          <button className="btn btn-filled btn-small" onClick={syncAll} disabled={syncing !== null}>
            <Icon name="refresh" size={18} className={syncing === 'all' ? 'spin' : ''} /> Проверить новинки у всех
          </button>
        )}
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && !data.length && (
        <Empty icon={<Icon name="hub" size={32} />} title="Вы ещё не подписаны на артистов">
          <p>Найдите артиста через поиск и нажмите «Подписаться» — его новые треки будут появляться в ленте и уведомлениях.</p>
          <Link to="/search" className="btn btn-filled">
            <Icon name="search" size={18} /> Найти артистов
          </Link>
        </Empty>
      )}
      <div className="subscriptions">
        {data?.map((a) => (
          <div key={a.id} className="subscription">
            <Link to={`/artists/${a.id}`}>
              <Avatar url={a.imageUrl} name={a.name} size={48} />
            </Link>
            <div className="subscription-main">
              <div className="row-gap">
                <Link to={`/artists/${a.id}`} className="strong">
                  {a.name}
                </Link>
                <ServiceBadge source={a.provider} />
              </div>
              <span className="muted small">
                {a.trackCount} {plural(a.trackCount, ['трек', 'трека', 'треков'])}
                {a.latestReleaseAt && <> · последний релиз {timeAgo(a.latestReleaseAt)}</>}
                {a.lastSyncedAt ? <> · проверено {timeAgo(a.lastSyncedAt)}</> : <> · ещё не синхронизирован</>}
              </span>
              {a.lastError && (
                <span className="small error-text">
                  <Icon name="error" size={18} /> {a.lastError}
                </span>
              )}
            </div>
            <button className="icon-btn" onClick={() => syncOne(a)} disabled={syncing !== null} title="Проверить новинки">
              <Icon name="refresh" className={syncing === a.id ? 'spin' : ''} />
            </button>
            <button className="icon-btn" onClick={() => unsubscribe(a)} title="Отписаться">
              <Icon name="delete" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
