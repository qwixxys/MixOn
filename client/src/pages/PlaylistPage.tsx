import { Globe, Lock, Pencil, Play, Shuffle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { Playlist, PlaylistDetail } from '../api/types';
import { Avatar, Cover } from '../components/Cover';
import { Modal } from '../components/Modal';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackRow } from '../components/TrackRow';
import { plural, timeAgo, totalDuration } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { usePlayer } from '../store/player';
import { toast } from '../store/toasts';

function EditPlaylistModal({ playlist, onClose, onSaved }: { playlist: Playlist; onClose(): void; onSaved(p: Playlist): void }) {
  const [title, setTitle] = useState(playlist.title);
  const [description, setDescription] = useState(playlist.description);
  const [isPublic, setIsPublic] = useState(playlist.isPublic);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onSaved(await api<Playlist>(`/playlists/${playlist.id}`, { method: 'PATCH', body: { title, description, isPublic } }));
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal title="Редактировать плейлист" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Название</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100} />
        </label>
        <label className="field">
          <span>Описание</span>
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={!isPublic} onChange={(e) => setIsPublic(!e.target.checked)} /> Приватный плейлист
        </label>
        <div className="form-actions">
          <button className="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}

export function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const { data, loading, error, setData } = useFetch<PlaylistDetail>(`/playlists/${id}`);
  const play = usePlayer((s) => s.play);
  const [editing, setEditing] = useState(false);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? 'Плейлист не найден'} />;
  const isOwner = user?.id === data.owner.id;

  const playAll = (shuffle = false) => {
    if (!data.tracks.length) return;
    usePlayer.setState({ shuffle });
    const start = shuffle ? data.tracks[Math.floor(Math.random() * data.tracks.length)] : data.tracks[0];
    play(start, data.tracks);
  };

  const removeTrack = async (trackId: number) => {
    try {
      const updated = await api<Playlist>(`/playlists/${data.id}/tracks/${trackId}`, { method: 'DELETE' });
      setData((d) => d && { ...d, ...updated, tracks: d.tracks.filter((t) => t.id !== trackId) });
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async () => {
    if (!confirm(`Удалить плейлист «${data.title}»?`)) return;
    try {
      await api(`/playlists/${data.id}`, { method: 'DELETE' });
      toast.success('Плейлист удалён');
      navigate('/library?tab=playlists');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="page">
      <section className="playlist-header">
        <Cover url={data.coverUrl} seed={`p${data.id}`} className="playlist-cover" />
        <div className="playlist-meta">
          <span className="muted small">
            {data.isPublic ? <Globe size={12} /> : <Lock size={12} />} {data.isPublic ? 'Публичный плейлист' : 'Приватный плейлист'}
          </span>
          <h1>{data.title}</h1>
          <Link to={`/users/${data.owner.username}`} className="byline">
            <Avatar url={data.owner.avatarUrl} name={data.owner.displayName} size={22} /> {data.owner.displayName}
          </Link>
          <span className="muted small">
            {data.trackCount} {plural(data.trackCount, ['трек', 'трека', 'треков'])} · {totalDuration(data.duration)} · обновлён{' '}
            {timeAgo(data.updatedAt)}
          </span>
          {data.description && <p className="description">{data.description}</p>}
          <div className="row-gap">
            <button className="btn btn-primary" onClick={() => playAll()} disabled={!data.tracks.length}>
              <Play size={16} fill="currentColor" /> Слушать
            </button>
            <button className="btn btn-outline" onClick={() => playAll(true)} disabled={!data.tracks.length}>
              <Shuffle size={16} /> Перемешать
            </button>
            {isOwner && (
              <>
                <button className="btn btn-ghost" onClick={() => setEditing(true)}>
                  <Pencil size={15} /> Изменить
                </button>
                <button className="btn btn-ghost btn-danger" onClick={remove}>
                  <Trash2 size={15} /> Удалить
                </button>
              </>
            )}
          </div>
        </div>
      </section>
      {!data.tracks.length ? (
        <Empty title="В плейлисте пока нет треков">Добавляйте треки кнопкой «В плейлист» на их карточках.</Empty>
      ) : (
        <div className="chart">
          {data.tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} queue={data.tracks} index={i} onRemove={isOwner ? () => removeTrack(t.id) : undefined} />
          ))}
        </div>
      )}
      {editing && <EditPlaylistModal playlist={data} onClose={() => setEditing(false)} onSaved={(p) => setData((d) => d && { ...d, ...p })} />}
    </div>
  );
}
