import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Track } from '../api/types';
import { gradientFor } from '../lib/gradient';
import { useNowPlaying } from '../lib/nowPlaying';
import { serviceInfo } from '../lib/services';
import { useAuth } from '../store/auth';
import { usePlayer } from '../store/player';
import { usePlaylistPicker } from '../store/playlistPicker';
import { onYoutubeShown, youtubeShown, youtubeStage } from '../store/youtube';
import { Cover } from './Cover';
import { DownloadButton } from './DownloadButton';
import { Icon } from './Icon';
import { LikeButton } from './LikeButton';
import { clearQueue, PlayerControls, Progress, QueueList, Volume } from './PlayerBar';
import { shareTrack } from './TrackActions';

/**
 * Holds the place of YouTube's window: while the full-screen player is open the window sits exactly over this spot,
 * where the cover would be (YouTube's player cannot be moved into the page without reloading the video).
 */
function VideoSpot({ layout }: { layout: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const place = () => {
    const box = ref.current?.getBoundingClientRect();
    if (box) youtubeStage({ top: box.top, left: box.left, width: box.width, height: box.height });
  };
  useLayoutEffect(() => {
    const el = ref.current!;
    // The spot moves when the space around it changes size, so watch its parent as well.
    const observer = new ResizeObserver(place);
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      youtubeStage(null);
    };
  }, []);
  useLayoutEffect(place, [layout]);
  return <div ref={ref} className="np-video" aria-hidden />;
}

function NowPlayingSheet({ track, onClose }: { track: Track; onClose(): void }) {
  const [queueOpen, setQueueOpen] = useState(false);
  const video = useSyncExternalStore(onYoutubeShown, youtubeShown);
  const error = usePlayer((s) => s.error);
  const user = useAuth((s) => s.user);
  const openPicker = usePlaylistPicker((s) => s.open);
  const navigate = useNavigate();
  const service = serviceInfo(track.source);
  const artistLink = track.externalArtist
    ? `/artists/${track.externalArtist.id}`
    : track.uploader
      ? `/users/${track.uploader.username}`
      : null;

  // Escape closes it; the page underneath stays put.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.documentElement.classList.add('now-playing');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('now-playing');
    };
  }, [onClose]);

  return (
    <div className="np" role="dialog" aria-modal="true" aria-label="Сейчас играет">
      <div className="np-backdrop" style={{ background: gradientFor(track.id) }} aria-hidden>
        {track.coverUrl && <img src={track.coverUrl} alt="" />}
      </div>

      <header className="np-head">
        <button className="icon-btn" onClick={onClose} aria-label="Свернуть плеер" title="Свернуть">
          <Icon name="keyboard_arrow_down" size={28} />
        </button>
        <div className="np-head-title">
          <span className="np-overline">Сейчас играет</span>
          {track.source !== 'local' && (
            <span className="np-source">
              <span className="service-dot" style={{ background: service.color }} />
              {service.label}
            </span>
          )}
        </div>
        <button
          className={`icon-btn ${queueOpen ? 'icon-btn-selected' : ''}`}
          onClick={() => setQueueOpen(!queueOpen)}
          aria-pressed={queueOpen}
          aria-label="Очередь"
          title="Очередь"
        >
          <Icon name="queue_music" />
        </button>
      </header>

      <div className="np-body">
        <div className={`np-stage ${queueOpen ? 'np-stage-queue' : ''}`}>
          {video ? <VideoSpot layout={queueOpen} /> : !queueOpen && <Cover url={track.coverUrl} seed={track.id} className="np-cover" />}
          {queueOpen && (
            <div className="np-queue">
              <div className="np-queue-head">
                <h3>Очередь</h3>
                <button className="btn btn-small btn-text" onClick={clearQueue}>
                  Очистить
                </button>
              </div>
              <QueueList />
            </div>
          )}
        </div>

        <div className="np-lower">
          <div className="np-titles">
            <div className="np-titles-text">
              <Link to={`/tracks/${track.id}`} replace className="np-title" title={track.title}>
                {track.title}
              </Link>
              {artistLink ? (
                <Link to={artistLink} replace className="np-artist">
                  {track.artist}
                </Link>
              ) : (
                <span className="np-artist">{track.artist}</span>
              )}
            </div>
            <LikeButton track={track} showCount={false} />
          </div>

          {error && <p className="np-error small">{error}</p>}
          {track.isPreview && (
            <div className="notice notice-warn np-notice">
              <Icon name="timer" size={18} />
              <span>
                Это 30-секундный отрывок: {service.label} без подписки не даёт послушать трек целиком. Полные треки — в ВК
                Музыке, SoundCloud и YouTube.
              </span>
            </div>
          )}

          <Progress stacked />
          <PlayerControls size={32} />

          <div className="np-actions">
            <button
              className="action-btn"
              title="Добавить в плейлист"
              onClick={() => (user ? openPicker(track) : navigate('/login', { replace: true }))}
            >
              <Icon name="playlist_add" size={20} />
              <span>В плейлист</span>
            </button>
            <DownloadButton track={track} labels />
            <Link to={`/tracks/${track.id}`} replace className="action-btn" title="Текст песни и комментарии">
              <Icon name="lyrics" size={20} />
              <span>Текст</span>
            </Link>
            <button className="action-btn" title="Скопировать ссылку" onClick={() => shareTrack(track)}>
              <Icon name="link" size={20} />
              <span>Ссылка</span>
            </button>
            <Volume />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The full-screen player, opened from the mini player, like the "Now playing" screen of music apps. */
export function NowPlaying() {
  const { open, hide, forget } = useNowPlaying();
  const current = usePlayer((s) => s.current);
  // A reload keeps the history entry but not the track: drop the flag instead of opening later by surprise.
  useEffect(() => {
    if (open && !current) forget();
  });
  if (!open || !current) return null;
  return <NowPlayingSheet track={current} onClose={hide} />;
}
