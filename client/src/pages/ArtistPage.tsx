import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import type { Artist, ArtistGenius, SyncResult } from '../api/types';
import { Avatar } from '../components/Cover';
import { GeniusArtistCard } from '../components/Genius';
import { ServiceBadge } from '../components/ServiceBadge';
import { Empty, ErrorState, Loading } from '../components/States';
import { FilteredTrackList } from '../components/FilteredTrackList';
import { formatCount, plural, timeAgo } from '../lib/format';
import { serviceInfo } from '../lib/services';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Icon } from '../components/Icon';
import { tr } from '../i18n/runtime';

export function ArtistPage() {
  const { id } = useParams();
  const user = useAuth((s) => s.user);
  const { data, loading, error, reload, setData } = useFetch<Artist>(`/artists/${id}`);
  // Genius is asked as soon as the page opens, alongside the artist's tracks.
  const genius = useFetch<ArtistGenius>(`/artists/${id}/genius`);
  // Bumped after a sync so the track list reloads too.
  const [version, setVersion] = useState(0);
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
        setVersion((v) => v + 1);
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
      setVersion((v) => v + 1);
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
          <Avatar url={data.imageUrl ?? genius.data?.artist?.imageUrl ?? null} name={data.name} size={180} />
          <div className="profile-hero-text">
            <span className="label-large">Артист · {service.label}</span>
            <h1 className="hero-title">{data.name}</h1>
            <span className="body-large">
              {formatCount(data.subscribers)} {plural(data.subscribers, ['подписчик', 'подписчика', 'подписчиков'])} на MixOn
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
        {data.lastError && <div className="notice notice-error">Последняя синхронизация не удалась: {tr(data.lastError)}</div>}
        <GeniusArtistCard genius={genius.data} loading={genius.loading} error={genius.error} onRetry={genius.reload} />
        <FilteredTrackList
          key={version}
          path={`/artists/${data.id}/tracks`}
          scope={`artist:${data.id}`}
          pageSize={50}
          empty={<Empty title="Треков пока нет">Нажмите «Обновить», чтобы загрузить треки из {service.label}.</Empty>}
        />
      </div>
    </>
  );
}
