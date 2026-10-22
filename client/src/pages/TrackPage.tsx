import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { Comment, Track } from '../api/types';
import { Avatar, Cover } from '../components/Cover';
import { FileButton, TextArea, TextField } from '../components/Material';
import { Modal } from '../components/Modal';
import { PlayButton } from '../components/PlayButton';
import { ServiceBadge } from '../components/ServiceBadge';
import { ErrorState, Loading } from '../components/States';
import { playableDuration, TrackByline } from '../components/TrackCard';
import { TrackActions } from '../components/TrackActions';
import { TrackRow } from '../components/TrackRow';
import { Waveform } from '../components/Waveform';
import { formatCount, formatDate, formatTime, plural, timeAgo } from '../lib/format';
import { serviceInfo } from '../lib/services';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { useLikeState } from '../store/likes';
import { usePlayer, useTrackProgress } from '../store/player';
import { toast } from '../store/toasts';
import { GENRES } from './UploadPage';
import { Icon } from '../components/Icon';

function EditTrackModal({ track, onClose, onSaved }: { track: Track; onClose(): void; onSaved(t: Track): void }) {
  const [form, setForm] = useState({
    title: track.title,
    artist: track.artist,
    genre: track.genre ?? '',
    description: track.description,
  });
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const data = new FormData();
    for (const [k, v] of Object.entries(form)) data.append(k, v.trim());
    if (cover) data.append('cover', cover);
    try {
      onSaved(await api<Track>(`/tracks/${track.id}`, { method: 'PATCH', form: data }));
      toast.success('Сохранено');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Редактировать трек" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <TextField label="Название" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
        <TextField label="Исполнитель" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} maxLength={200} />
        <TextField label="Жанр" list="edit-genres" value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} maxLength={50} />
        <datalist id="edit-genres">
          {GENRES.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <TextArea label="Описание" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} />
        <FileButton label="Заменить обложку" accept="image/jpeg,image/png,image/webp,image/gif" file={cover} onChange={setCover} icon={<Icon name="add_photo_alternate" size={18} />} />
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

function Comments({ track, comments, setComments }: { track: Track; comments: Comment[]; setComments(c: Comment[]): void }) {
  const user = useAuth((s) => s.user);
  const isCurrent = usePlayer((s) => s.current?.id === track.id);
  const currentTime = usePlayer((s) => (s.current?.id === track.id ? s.currentTime : 0));
  const play = usePlayer((s) => s.play);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const at = isCurrent && currentTime > 0 ? currentTime : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const comment = await api<Comment>(`/tracks/${track.id}/comments`, { body: { body: body.trim(), atSeconds: at } });
      setComments([comment, ...comments]);
      setBody('');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Comment) => {
    try {
      await api(`/tracks/${track.id}/comments/${c.id}`, { method: 'DELETE' });
      setComments(comments.filter((x) => x.id !== c.id));
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <section className="comments" id="comments">
      {user ? (
        <form className="comment-form" onSubmit={submit}>
          <Avatar url={user.avatarUrl} name={user.displayName} size={40} />
          <TextField
            label={at !== null ? `Комментарий на ${formatTime(at)}` : 'Комментарий'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
          />
          <button className="btn btn-filled" disabled={busy || !body.trim()}>
            Отправить
          </button>
        </form>
      ) : (
        <p className="muted">
          <Link to="/login">Войдите</Link>, чтобы оставить комментарий.
        </p>
      )}
      <h3 className="comments-title">
        <Icon name="chat_bubble" size={18} /> {comments.length} {plural(comments.length, ['комментарий', 'комментария', 'комментариев'])}
      </h3>
      {comments.map((c) => (
        <div key={c.id} className="comment">
          <Link to={`/users/${c.user.username}`}>
            <Avatar url={c.user.avatarUrl} name={c.user.displayName} size={40} />
          </Link>
          <div className="comment-main">
            <div className="comment-meta">
              <Link to={`/users/${c.user.username}`}>{c.user.displayName}</Link>
              {c.atSeconds !== null && (
                <>
                  {' '}
                  <span className="muted">на</span>{' '}
                  <button className="link-btn" onClick={() => play(track, undefined, c.atSeconds!)}>
                    {formatTime(c.atSeconds)}
                  </button>
                </>
              )}
              <span className="muted small"> · {timeAgo(c.createdAt)}</span>
            </div>
            <p>{c.body}</p>
          </div>
          {c.canDelete && (
            <button className="icon-btn" onClick={() => remove(c)} title="Удалить комментарий">
              <Icon name="delete" size={18} />
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

export function TrackPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const track = useFetch<Track>(`/tracks/${id}`);
  const comments = useFetch<Comment[]>(`/tracks/${id}/comments`);
  const related = useFetch<Track[]>(`/tracks/${id}/related`);
  const [editing, setEditing] = useState(false);
  const progress = useTrackProgress(Number(id));
  const isCurrent = usePlayer((s) => s.current?.id === Number(id));
  const playerDuration = usePlayer((s) => (s.current?.id === Number(id) ? s.duration : 0));
  const play = usePlayer((s) => s.play);
  const seek = usePlayer((s) => s.seek);
  const t = track.data;
  const likes = useLikeState(t ?? ({ id: 0, liked: false, likeCount: 0 } as Track));

  useEffect(() => {
    if (location.hash === '#comments' && comments.data) document.getElementById('comments')?.scrollIntoView();
  }, [comments.data]);

  if (track.loading) return <Loading />;
  if (track.error || !t) return <ErrorState message={track.error ?? 'Трек не найден'} />;

  const duration = isCurrent && playerDuration ? playerDuration : playableDuration(t);
  const isOwner = user && t.uploader?.id === user.id;
  const service = serviceInfo(t.source);

  const remove = async () => {
    if (!confirm(`Удалить «${t.title}»? Это действие нельзя отменить.`)) return;
    try {
      await api(`/tracks/${t.id}`, { method: 'DELETE' });
      toast.success('Трек удалён');
      navigate(`/users/${user!.username}`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <section className="track-hero" style={t.coverUrl ? ({ '--hero-image': `url(${t.coverUrl})` } as React.CSSProperties) : undefined}>
        <div className="track-hero-inner">
          <div className="track-hero-main">
            <div className="track-hero-head">
              <PlayButton track={t} queue={related.data ? [t, ...related.data] : undefined} size={62} />
              <div className="track-hero-titles">
                <TrackByline track={t} />
                <h1 className="hero-title">{t.title}</h1>
              </div>
              <div className="track-hero-meta">
                <span>{timeAgo(t.releasedAt ?? t.createdAt)}</span>
                {t.genre && (
                  <Link to={`/discover?genre=${encodeURIComponent(t.genre)}`} className="tag tag-dark">
                    #{t.genre}
                  </Link>
                )}
              </div>
            </div>
            <Waveform
              peaks={t.waveform}
              progress={progress}
              height={110}
              variant="dark"
              duration={duration}
              comments={comments.data ?? undefined}
              onSeek={(f) => (isCurrent ? seek(f * duration) : play(t, undefined, f * duration))}
            />
          </div>
          <Cover url={t.coverUrl} seed={t.id} className="track-hero-cover" />
        </div>
      </section>

      <div className="page">
        <div className="with-sidebar">
          <div className="content">
            <div className="track-toolbar">
              <TrackActions track={t} labels />
              {isOwner && (
                <div className="track-actions">
                  <button className="action-btn" onClick={() => setEditing(true)}>
                    <Icon name="edit" size={18} /> <span>Изменить</span>
                  </button>
                  <button className="action-btn action-btn-danger" onClick={remove}>
                    <Icon name="delete" size={18} /> <span>Удалить</span>
                  </button>
                </div>
              )}
              <div className="track-stats">
                <span>
                  <Icon name="play_arrow" size={18} filled /> {formatCount(t.playCount)}
                </span>
                <span>♥ {formatCount(likes.likeCount)}</span>
                <span>
                  <Icon name="chat_bubble" size={18} /> {formatCount(comments.data?.length ?? t.commentCount)}
                </span>
              </div>
            </div>

            {t.isPreview && (
              <div className="notice">
                <Icon name="info" size={18} />
                <span>
                  {service.label} отдаёт только 30-секундный фрагмент.{' '}
                  {t.externalUrl && (
                    <a href={t.externalUrl} target="_blank" rel="noreferrer">
                      Полная версия в {service.label}
                    </a>
                  )}
                </span>
              </div>
            )}

            <div className="track-info">
              {t.uploader ? (
                <Link to={`/users/${t.uploader.username}`} className="track-info-author">
                  <Avatar url={t.uploader.avatarUrl} name={t.uploader.displayName} size={80} />
                  <span>{t.uploader.displayName}</span>
                </Link>
              ) : t.externalArtist ? (
                <Link to={`/artists/${t.externalArtist.id}`} className="track-info-author">
                  <Avatar url={t.externalArtist.imageUrl} name={t.externalArtist.name} size={80} />
                  <span>{t.externalArtist.name}</span>
                </Link>
              ) : null}
              <div className="track-info-text">
                {t.description && <p className="description">{t.description}</p>}
                <dl className="facts">
                  <dt>Исполнитель</dt>
                  <dd>{t.artist}</dd>
                  {t.album && (
                    <>
                      <dt>Альбом</dt>
                      <dd>{t.album}</dd>
                    </>
                  )}
                  <dt>{t.source === 'local' ? 'Загружен' : 'Релиз'}</dt>
                  <dd>{formatDate(t.releasedAt ?? t.createdAt)}</dd>
                  <dt>Длительность</dt>
                  <dd>{formatTime(t.duration)}</dd>
                  <dt>Источник</dt>
                  <dd>{t.source === 'local' ? 'Загружен на soundFy' : <ServiceBadge source={t.source} preview={t.isPreview} />}</dd>
                </dl>
              </div>
            </div>

            {comments.data && (
              <Comments track={t} comments={comments.data} setComments={(c) => comments.setData(() => c)} />
            )}
          </div>

          <aside className="sidebar">
            {related.data && related.data.length > 0 && (
              <section className="side-card">
                <div className="side-card-header">
                  <h3>Похожие треки</h3>
                </div>
                {related.data.map((r) => (
                  <TrackRow key={r.id} track={r} queue={related.data!} compact />
                ))}
              </section>
            )}
          </aside>
        </div>
      </div>
      {editing && <EditTrackModal track={t} onClose={() => setEditing(false)} onSaved={(nt) => track.setData(() => nt)} />}
    </>
  );
}
