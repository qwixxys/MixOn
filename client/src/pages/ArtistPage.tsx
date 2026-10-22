import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import type { ArtistDetail, SyncResult } from '../api/types';
import { Avatar } from '../components/Cover';
import { ServiceBadge } from '../components/ServiceBadge';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackCard';
import { formatCount, plural, timeAgo } from '../lib/format';
import { serviceInfo } from '../lib/services';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Icon } from '../components/Icon';

export function ArtistPage() {
  const { id } = useParams();
  const user = useAuth((s) => s.user);
  const { data, loading, error, reload, setData } = useFetch<ArtistDetail>(`/artists/${id}`);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? 'Артист не найден'} />;
  const service = serviceInfo(data.provider);

  const toggle = async () => {
    setBusy(true);
    try {
      if (data.isSubscribed) {
        await api(`/subscriptions/${data.id}`, { method: 'DELETE' });
        setData((d) => d && { ...d, isSubscribed: false, subscribers: d.subscribers - 1 });
      } else {
        await api('/subscriptions', {
          body: { provider: data.provider, externalId: data.externalId, name: data.name, imageUrl: data.imageUrl, url: data.url },
        });
        toast.success(`Вы подписаны на ${data.name}`);
        reload();
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const result = await api<SyncResult>(`/artists/${data.id}/sync`, { method: 'POST' });
      toast.success(
        result.newTracks
          ? `Найдено ${result.newTracks} ${plural(result.newTracks, ['новый трек', 'новых трека', 'новых треков'])}`
          : 'Новых треков нет',
      );
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="profile-hero">
        <div className="profile-hero-inner">
          <Avatar url={data.imageUrl} name={data.name} size={180} />
          <div className="profile-hero-text">
            <span className="label-large">Артист · {service.label}</span>
            <h1 className="hero-title">{data.name}</h1>
            <span className="body-large">
              {formatCount(data.subscribers)} {plural(data.subscribers, ['подписчик', 'подписчика', 'подписчиков'])} на soundFy
            </span>
          </div>
        </div>
      </section>
      <div className="page">
        <div className="profile-bar">
          <div className="row-gap">
            <ServiceBadge source={data.provider} />
            <span className="muted small">
              {data.trackCount} {plural(data.trackCount, ['трек', 'трека', 'треков'])}
              {data.lastSyncedAt && <> · обновлено {timeAgo(data.lastSyncedAt)}</>}
            </span>
          </div>
          <div className="row-gap">
            {data.url && (
              <a className="btn btn-text" href={data.url} target="_blank" rel="noreferrer">
                <Icon name="open_in_new" size={18} /> {service.label}
              </a>
            )}
            {user && (
              <button className="btn btn-outlined" onClick={sync} disabled={busy}>
                <Icon name="refresh" size={18} className={busy ? 'spin' : ''} /> Обновить
              </button>
            )}
            {user ? (
              <button className={`btn ${data.isSubscribed ? 'btn-outlined' : 'btn-filled'}`} onClick={toggle} disabled={busy}>
                {data.isSubscribed ? 'Вы подписаны' : 'Следить за релизами'}
              </button>
            ) : (
              <Link to="/login" className="btn btn-filled">
                Следить за релизами
              </Link>
            )}
          </div>
        </div>
        {data.lastError && <div className="notice notice-error">Последняя синхронизация не удалась: {data.lastError}</div>}
        {data.tracks.length ? (
          <TrackList tracks={data.tracks} />
        ) : (
          <Empty title="Треков пока нет">Нажмите «Обновить», чтобы загрузить треки из {service.label}.</Empty>
        )}
      </div>
    </>
  );
}
