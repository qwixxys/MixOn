import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import type { Me, Playlist, Profile, Track } from '../api/types';
import { Avatar } from '../components/Cover';
import { FileButton, TextArea, TextField } from '../components/Material';
import { Modal } from '../components/Modal';
import { PlaylistGrid } from '../components/PlaylistTile';
import { Empty, ErrorState, Loading } from '../components/States';
import { Tabs } from '../components/Tabs';
import { TrackList } from '../components/TrackCard';
import { formatCount, formatDate, plural } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { usePaged } from '../lib/usePaged';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Icon } from '../components/Icon';

function EditProfileModal({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const user = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData();
    form.append('displayName', displayName.trim());
    form.append('bio', bio.trim());
    if (avatar) form.append('avatar', avatar);
    try {
      const { user: updated } = await api<{ user: Me }>('/me', { method: 'PATCH', form });
      setUser(updated);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Редактировать профиль" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <TextField label="Отображаемое имя" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={60} />
        <TextArea label="О себе" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={1000} />
        <FileButton label="Выбрать аватар" accept="image/jpeg,image/png,image/webp,image/gif" file={avatar} onChange={setAvatar} icon={<Icon name="add_photo_alternate" size={18} />} />
        <div className="form-actions">
          <button type="button" className="btn btn-text" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-filled" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Tab = 'tracks' | 'playlists' | 'likes';

function TrackTab({ path, empty }: { path: string; empty: React.ReactNode }) {
  const list = usePaged<Track>(path);
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  return (
    <>
      {!list.loading && !list.items.length && empty}
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

export function ProfilePage() {
  const { username = '' } = useParams();
  const me = useAuth((s) => s.user);
  const profile = useFetch<Profile>(`/users/${encodeURIComponent(username)}`);
  const playlists = useFetch<Playlist[]>(`/users/${encodeURIComponent(username)}/playlists`);
  const [tab, setTab] = useState<Tab>('tracks');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (profile.loading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorState message={profile.error ?? 'Пользователь не найден'} />;
  const p = profile.data;

  const toggleFollow = async () => {
    setBusy(true);
    try {
      await api(`/users/${p.username}/follow`, { method: p.isFollowing ? 'DELETE' : 'POST' });
      profile.setData((d) => d && { ...d, isFollowing: !d.isFollowing, followers: d.followers + (d.isFollowing ? -1 : 1) });
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
          <Avatar url={p.avatarUrl} name={p.displayName} size={180} />
          <div className="profile-hero-text">
            <span className="label-large">Профиль</span>
            <h1 className="hero-title">{p.displayName}</h1>
            <span className="body-large">@{p.username}</span>
          </div>
        </div>
      </section>
      <div className="page">
        <div className="profile-bar">
          <Tabs
            tabs={[
              { id: 'tracks', label: 'Треки', count: p.trackCount },
              { id: 'playlists', label: 'Плейлисты', count: playlists.data?.length },
              { id: 'likes', label: 'Лайки', count: p.likeCount },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="row-gap">
            {p.isMe ? (
              <button className="btn btn-outlined" onClick={() => setEditing(true)}>
                <Icon name="edit" size={18} /> Редактировать
              </button>
            ) : me ? (
              <button className={`btn ${p.isFollowing ? 'btn-outlined' : 'btn-filled'}`} onClick={toggleFollow} disabled={busy}>
                {p.isFollowing ? 'Вы подписаны' : 'Подписаться'}
              </button>
            ) : (
              <Link to="/login" className="btn btn-filled">
                Подписаться
              </Link>
            )}
          </div>
        </div>
        <div className="with-sidebar">
          <div className="content">
            {tab === 'tracks' && (
              <TrackTab
                path={`/users/${encodeURIComponent(p.username)}/tracks`}
                empty={
                  <Empty title={p.isMe ? 'Вы ещё ничего не загрузили' : 'Треков пока нет'}>
                    {p.isMe && (
                      <Link to="/upload" className="btn btn-filled">
                        <Icon name="upload" size={18} /> Загрузить первый трек
                      </Link>
                    )}
                  </Empty>
                }
              />
            )}
            {tab === 'likes' && (
              <TrackTab path={`/users/${encodeURIComponent(p.username)}/likes`} empty={<Empty title="Понравившихся треков пока нет" />} />
            )}
            {tab === 'playlists' &&
              (playlists.data?.length ? (
                <PlaylistGrid playlists={playlists.data} />
              ) : (
                <Empty title="Плейлистов пока нет" />
              ))}
          </div>
          <aside className="sidebar">
            <section className="side-card">
              <div className="stats-row">
                <div>
                  <span className="muted small">Подписчики</span>
                  <strong>{formatCount(p.followers)}</strong>
                </div>
                <div>
                  <span className="muted small">Подписки</span>
                  <strong>{formatCount(p.following)}</strong>
                </div>
                <div>
                  <span className="muted small">Треки</span>
                  <strong>{formatCount(p.trackCount)}</strong>
                </div>
              </div>
              {p.bio && <p className="bio">{p.bio}</p>}
              <p className="muted small">
                На soundFy с {formatDate(p.createdAt)} · {p.likeCount} {plural(p.likeCount, ['лайк', 'лайка', 'лайков'])}
              </p>
            </section>
          </aside>
        </div>
      </div>
      {editing && <EditProfileModal onClose={() => setEditing(false)} onSaved={profile.reload} />}
    </>
  );
}
