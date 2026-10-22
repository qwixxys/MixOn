import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { Artist, Playlist, Track } from '../api/types';
import { Avatar } from '../components/Cover';
import { Switch, TextArea, TextField } from '../components/Material';
import { Modal } from '../components/Modal';
import { PlaylistGrid } from '../components/PlaylistTile';
import { ServiceBadge } from '../components/ServiceBadge';
import { Empty, ErrorState, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { TrackList } from '../components/TrackCard';
import { plural } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { usePaged } from '../lib/usePaged';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Icon } from '../components/Icon';

type Tab = 'likes' | 'playlists' | 'history' | 'artists';

function PagedTracks({ path, empty }: { path: string; empty: string }) {
  const list = usePaged<Track>(path);
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  return (
    <>
      {!list.loading && !list.items.length && <Empty title={empty} />}
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

function NewPlaylistModal({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/playlists', { body: { title, description, isPublic } });
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal title="Новый плейлист" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <TextField label="Название" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100} autoFocus />
        <TextArea label="Описание" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        <Switch checked={!isPublic} onChange={(v) => setIsPublic(!v)} label="Приватный плейлист" description="Виден только вам" />
        <div className="form-actions">
          <button className="btn btn-filled">Создать</button>
        </div>
      </form>
    </Modal>
  );
}

function Playlists() {
  const { data, loading, reload } = useFetch<Playlist[]>('/me/playlists');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="section-header">
        <span />
        <button className="btn btn-outlined btn-small" onClick={() => setCreating(true)}>
          <Icon name="add" size={18} /> Новый плейлист
        </button>
      </div>
      {loading && <Loading />}
      {data && !data.length && <Empty title="Плейлистов пока нет">Добавляйте треки в плейлисты кнопкой «+» на карточке трека.</Empty>}
      {data && <PlaylistGrid playlists={data} />}
      {creating && <NewPlaylistModal onClose={() => setCreating(false)} onCreated={reload} />}
    </>
  );
}

function Artists() {
  const { data, loading } = useFetch<Artist[]>('/subscriptions');
  if (loading) return <Loading />;
  if (!data?.length) {
    return (
      <Empty icon={<Icon name="hub" size={32} />} title="Вы ещё не подписаны на артистов">
        <Link to="/sync" className="btn btn-filled">
          Найти артистов в сервисах
        </Link>
      </Empty>
    );
  }
  return (
    <div className="people">
      {data.map((a) => (
        <Link key={a.id} to={`/artists/${a.id}`} className="person">
          <Avatar url={a.imageUrl} name={a.name} size={120} />
          <span className="person-name">{a.name}</span>
          <ServiceBadge source={a.provider} />
          <span className="muted small">
            {a.trackCount} {plural(a.trackCount, ['трек', 'трека', 'треков'])}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function LibraryPage() {
  const user = useAuth((s) => s.user)!;
  const [params, setParams] = useSearchParams();
  const tab = (['likes', 'playlists', 'history', 'artists'].includes(params.get('tab') ?? '') ? params.get('tab') : 'likes') as Tab;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Медиатека</h1>
        <Tabs
          tabs={[
            { id: 'likes', label: 'Лайки' },
            { id: 'playlists', label: 'Плейлисты' },
            { id: 'history', label: 'История' },
            { id: 'artists', label: 'Артисты' },
          ]}
          value={tab}
          onChange={(id) => setParams({ tab: id })}
        />
      </div>
      {tab === 'likes' && <PagedTracks path={`/users/${user.username}/likes`} empty="Понравившихся треков пока нет" />}
      {tab === 'history' && <PagedTracks path="/me/history" empty="Вы ещё ничего не слушали" />}
      {tab === 'playlists' && <Playlists />}
      {tab === 'artists' && <Artists />}
    </div>
  );
}
