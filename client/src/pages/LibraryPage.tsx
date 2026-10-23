import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { Playlist } from '../api/types';
import { Switch, TextArea, TextField } from '../components/Material';
import { Modal } from '../components/Modal';
import { MyArtists } from '../components/MyArtists';
import { PlaylistGrid } from '../components/PlaylistTile';
import { Empty, Loading } from '../components/States';
import { FilteredTrackList } from '../components/FilteredTrackList';
import { ImportPlaylistDialog } from '../components/ImportPlaylist';
import { Tabs } from '../components/Tabs';
import { TrackRow } from '../components/TrackRow';
import { plural } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { useDownloads, useSavedTracks } from '../store/downloads';
import { toast } from '../store/toasts';
import { Icon } from '../components/Icon';

type Tab = 'likes' | 'playlists' | 'history' | 'artists' | 'downloads';
const TABS: Tab[] = ['likes', 'playlists', 'history', 'artists', 'downloads'];

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;

/** Tracks saved on this device; the list itself is stored with them, so it shows even without internet. */
function Downloads() {
  const saved = useSavedTracks();
  const remove = useDownloads((s) => s.remove);
  const removeAll = useDownloads((s) => s.removeAll);
  if (!saved.length) {
    return (
      <Empty icon={<Icon name="download" size={32} />} title="Скачанных треков пока нет">
        Нажмите «Скачать» у трека или плейлиста — он будет играть и без интернета. Треки YouTube скачать нельзя: YouTube это
        запрещает.
      </Empty>
    );
  }
  const tracks = saved.map((s) => s.track);
  const size = saved.reduce((n, s) => n + s.size, 0);
  const clear = async () => {
    if (!confirm('Удалить все скачанные треки с этого устройства?')) return;
    await removeAll();
    toast.info('Скачанные треки удалены');
  };
  return (
    <section>
      <div className="downloads-head">
        <span className="muted">
          {tracks.length} {plural(tracks.length, ['трек', 'трека', 'треков'])} · {megabytes(size)} на устройстве
        </span>
        <button className="btn btn-text btn-danger" onClick={clear}>
          <Icon name="delete" size={18} /> Удалить все
        </button>
      </div>
      <div className="chart">
        {tracks.map((t) => (
          <TrackRow key={t.id} track={t} queue={tracks} onRemove={() => void remove(t.id)} />
        ))}
      </div>
    </section>
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
  const [importing, setImporting] = useState(false);
  return (
    <>
      <div className="section-header">
        <span />
        <div className="row-gap">
          <button className="btn btn-text btn-small" onClick={() => setImporting(true)}>
            <Icon name="link" size={18} /> Импорт по ссылке
          </button>
          <button className="btn btn-outlined btn-small" onClick={() => setCreating(true)}>
            <Icon name="add" size={18} /> Новый плейлист
          </button>
        </div>
      </div>
      {loading && <Loading />}
      {data && !data.length && <Empty title="Плейлистов пока нет">Добавляйте треки в плейлисты кнопкой «+» на карточке трека.</Empty>}
      {data && <PlaylistGrid playlists={data} />}
      {creating && <NewPlaylistModal onClose={() => setCreating(false)} onCreated={reload} />}
      {importing && <ImportPlaylistDialog onClose={() => setImporting(false)} />}
    </>
  );
}

export function LibraryPage() {
  const user = useAuth((s) => s.user)!;
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'likes') as Tab;

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
            { id: 'downloads', label: 'Скачанные' },
          ]}
          value={tab}
          onChange={(id) => setParams({ tab: id })}
        />
      </div>
      {tab === 'likes' && (
        <FilteredTrackList
          key="likes"
          path={`/users/${user.username}/likes`}
          scope={`likes:${user.username}`}
          empty={<Empty title="Понравившихся треков пока нет" />}
          sortLabels={{ new: 'Недавно понравившиеся' }}
        />
      )}
      {tab === 'history' && (
        <FilteredTrackList
          key="history"
          path="/me/history"
          scope="history"
          empty={<Empty title="Вы ещё ничего не слушали" />}
          sortLabels={{ new: 'Недавно прослушанные' }}
        />
      )}
      {tab === 'playlists' && <Playlists />}
      {tab === 'artists' && <MyArtists />}
      {tab === 'downloads' && <Downloads />}
    </div>
  );
}
