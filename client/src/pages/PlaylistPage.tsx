import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { Playlist, PlaylistDetail, Track, TrackSort } from '../api/types';
import { GenreBar, localFacets, NO_GENRE } from '../components/GenreBar';
import { useListQuery } from '../lib/useListQuery';
import { Avatar, Cover } from '../components/Cover';
import { Switch, TextArea, TextField } from '../components/Material';
import { Modal } from '../components/Modal';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackRow } from '../components/TrackRow';
import { plural, timeAgo, totalDuration } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { usePlayer } from '../store/player';
import { toast } from '../store/toasts';
import { Icon } from '../components/Icon';

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
        <TextField label="Название" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100} />
        <TextArea label="Описание" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        <Switch checked={!isPublic} onChange={(v) => setIsPublic(!v)} label="Приватный плейлист" description="Виден только вам" />
        <div className="form-actions">
          <button className="btn btn-filled">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}

/** Filters and sorts a fully loaded list the way the server does for paged ones. */
function arrangeTracks(tracks: Track[], genre: string | null, sort: TrackSort): Track[] {
  const filtered = genre ? tracks.filter((t) => (genre === NO_GENRE ? !t.genre : t.genre?.toLocaleLowerCase() === genre.toLocaleLowerCase())) : tracks;
  const byTitle = (a: Track, b: Track) => a.title.localeCompare(b.title, 'ru');
  switch (sort) {
    case 'popular':
      return [...filtered].sort((a, b) => b.playCount - a.playCount);
    case 'title':
      return [...filtered].sort(byTitle);
    case 'genre':
      // Untagged last; inside a genre the playlist order is kept (Array.prototype.sort is stable).
      return [...filtered].sort((a, b) => (a.genre === null ? 1 : 0) - (b.genre === null ? 1 : 0) || (a.genre ?? '').localeCompare(b.genre ?? '', 'ru'));
    default:
      return filtered;
  }
}

export function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const { data, loading, error, setData } = useFetch<PlaylistDetail>(`/playlists/${id}`);
  const list = useListQuery();
  const play = usePlayer((s) => s.play);
  const [editing, setEditing] = useState(false);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? 'Плейлист не найден'} />;
  const isOwner = user?.id === data.owner.id;
  const visible = arrangeTracks(data.tracks, list.genre, list.sort);

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
            {data.isPublic ? <Icon name="public" size={18} /> : <Icon name="lock" size={18} />} {data.isPublic ? 'Публичный плейлист' : 'Приватный плейлист'}
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
            <button className="btn btn-filled" onClick={() => playAll()} disabled={!data.tracks.length}>
              <Icon name="play_arrow" size={18} filled /> Слушать
            </button>
            <button className="btn btn-outlined" onClick={() => playAll(true)} disabled={!data.tracks.length}>
              <Icon name="shuffle" size={18} /> Перемешать
            </button>
            {isOwner && (
              <>
                <button className="btn btn-text" onClick={() => setEditing(true)}>
                  <Icon name="edit" size={18} /> Изменить
                </button>
                <button className="btn btn-text btn-danger" onClick={remove}>
                  <Icon name="delete" size={18} /> Удалить
                </button>
              </>
            )}
          </div>
        </div>
      </section>
      {!data.tracks.length ? (
        <Empty title="В плейлисте пока нет треков">Добавляйте треки кнопкой «В плейлист» на их карточках.</Empty>
      ) : (
        <>
          <GenreBar
            facets={localFacets(data.tracks)}
            genre={list.genre}
            sort={list.sort}
            onChange={list.update}
            sortLabels={{ new: 'Порядок плейлиста' }}
          />
          <div className="chart">
            {visible.map((t, i) => (
              <Fragment key={t.id}>
                {list.sort === 'genre' && (i === 0 || visible[i - 1].genre !== t.genre) && (
                  <h3 className="list-subheader">
                    <Icon name="category" size={20} />
                    {t.genre ?? 'Без жанра'}
                  </h3>
                )}
                <TrackRow track={t} queue={visible} index={i} onRemove={isOwner ? () => removeTrack(t.id) : undefined} />
              </Fragment>
            ))}
            {!visible.length && <Empty title="В этом жанре треков нет" />}
          </div>
        </>
      )}
      {editing && <EditPlaylistModal playlist={data} onClose={() => setEditing(false)} onSaved={(p) => setData((d) => d && { ...d, ...p })} />}
    </div>
  );
}
