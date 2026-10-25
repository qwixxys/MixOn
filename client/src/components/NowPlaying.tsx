import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Track, TrackLyrics } from '../api/types';
import { gradientFor } from '../lib/gradient';
import { useNowPlaying } from '../lib/nowPlaying';
import { useFetch } from '../lib/useFetch';
import { serviceInfo } from '../lib/services';
import { useAuth } from '../store/auth';
import { usePlayer } from '../store/player';
import { usePlaylistPicker } from '../store/playlistPicker';
import { onYoutubeShown, youtubeHide, youtubeShown, youtubeStage } from '../store/youtube';
import { Cover } from './Cover';
import { DownloadButton } from './DownloadButton';
import { Icon } from './Icon';
import { LikeButton } from './LikeButton';
import { ListenOn } from './PlayVia';
import { DislikeButton } from './Wave';
import { SyncedLyrics } from './Lyrics';
import { clearQueue, PlayerControls, Progress, QueueList, Volume } from './PlayerBar';
import { shareTrack } from './TrackActions';

/**
 * Holds the place of YouTube's window: while the full-screen player is open the window sits exactly over this spot,
 * where the cover would be (YouTube's player cannot be moved into the page without reloading the video). In the
 * cover's place it is square like the cover; beside the lyrics or the queue, just the video's width.
 */
function VideoSpot({ layout, square }: { layout: unknown; square: boolean }) {
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
  useLayoutEffect(place, [layout, square]);
  return <div ref={ref} className={`np-video ${square ? 'np-video-square' : ''}`} aria-hidden />;
}

/** Windows at least this wide show the lyrics in a column of their own; narrower ones swap them in for the cover. */
const LYRICS_COLUMN = window.matchMedia('(min-width: 1200px)');

function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      LYRICS_COLUMN.addEventListener('change', onChange);
      return () => LYRICS_COLUMN.removeEventListener('change', onChange);
    },
    () => LYRICS_COLUMN.matches,
  );
}

const LYRICS_KEY = 'soundfy.npLyrics';

/** Whether wide windows show the lyrics column; the listener can turn it off, and the choice is remembered. */
function useLyricsColumn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(LYRICS_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const set = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(LYRICS_KEY, next ? 'on' : 'off');
    } catch {
      // storage unavailable: the choice lasts while the player is open
    }
  };
  return [on, set];
}

type LyricsFetch = ReturnType<typeof useFetch<TrackLyrics>>;

/** Whether the lyrics have words to show (not missing, not an instrumental). */
const hasWords = (lyrics: LyricsFetch) => {
  const found = lyrics.data?.found ? lyrics.data : null;
  return Boolean(found && !found.instrumental && (found.synced?.length || found.plain));
};

/** The song's lyrics from LRCLIB, following playback when they are time-synced. */
function NowPlayingLyrics({ track, lyrics }: { track: Track; lyrics: LyricsFetch }) {
  const found = lyrics.data?.found ? lyrics.data : null;
  let body;
  if (lyrics.loading) {
    body = (
      <p className="np-lyrics-note muted">
        <Icon name="progress_activity" size={18} className="spin" /> Ищем текст песни…
      </p>
    );
  } else if (lyrics.error) {
    body = <p className="np-lyrics-note muted">Текст не загрузился: {lyrics.error}</p>;
  } else if (found?.instrumental) {
    body = <p className="np-lyrics-note muted">Инструментальный трек — в нём нет слов.</p>;
  } else if (found?.synced?.length) {
    body = <SyncedLyrics track={track} lines={found.synced} />;
  } else if (found?.plain) {
    body = <div className="plain-lyrics">{found.plain}</div>;
  } else {
    body = <p className="np-lyrics-note muted">Текста для этой песни не нашлось.</p>;
  }
  // The source (LRCLIB) is named on the track page's «Текст» tab; here the lyrics stand alone.
  return <div className="np-lyrics">{body}</div>;
}

type Panel = 'cover' | 'queue' | 'lyrics';

function NowPlayingSheet({ track, onClose }: { track: Track; onClose(): void }) {
  const wide = useWide();
  const [columnOn, setColumnOn] = useLyricsColumn();
  const lyrics = useFetch<TrackLyrics>(`/tracks/${track.id}/lyrics`);
  // While the next song's lyrics load, the layout stays as it was, so it does not jump at every track.
  const hadWords = useRef(false);
  const words = lyrics.loading ? hadWords.current : hasWords(lyrics);
  useEffect(() => {
    if (!lyrics.loading) hadWords.current = words;
  });
  // Wide windows: the lyrics in a column beside the cover when there are any and the listener wants them; otherwise
  // the cover with the controls beside it.
  const column = wide && columnOn && words;
  const [chosen, setPanel] = useState<Panel>('cover');
  // Wide windows show the lyrics beside the controls, so the stage never needs to swap them in there.
  const panel: Panel = wide && chosen === 'lyrics' ? 'cover' : chosen;
  const toggle = (p: Panel) => setPanel(panel === p ? 'cover' : p);
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
          <ListenOn track={track} />
        </div>
        <div className="np-head-actions">
          {/* Narrow windows swap the lyrics in for the cover; wide ones turn their column on and off. */}
          {(!wide || words) && (
            <button
              className={`icon-btn ${(wide ? column : panel === 'lyrics') ? 'icon-btn-selected' : ''}`}
              onClick={() => (wide ? setColumnOn(!columnOn) : toggle('lyrics'))}
              aria-pressed={wide ? column : panel === 'lyrics'}
              aria-label="Текст песни"
              title="Текст песни"
            >
              <Icon name="lyrics" />
            </button>
          )}
          <button
            className={`icon-btn ${panel === 'queue' ? 'icon-btn-selected' : ''}`}
            onClick={() => toggle('queue')}
            aria-pressed={panel === 'queue'}
            aria-label="Очередь"
            title="Очередь"
          >
            <Icon name="queue_music" />
          </button>
        </div>
      </header>

      <div className={`np-body ${column ? 'np-body-lyrics' : ''}`}>
        <div className={`np-stage ${panel !== 'cover' ? 'np-stage-queue' : ''}`}>
          {video ? (
            <VideoSpot layout={`${panel}:${column}`} square={panel === 'cover'} />
          ) : (
            panel === 'cover' && <Cover url={track.coverUrl} seed={track.id} className="np-cover" />
          )}
          {panel === 'lyrics' && <NowPlayingLyrics key={track.id} track={track} lyrics={lyrics} />}
          {panel === 'queue' && (
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
            {video && (
              // YouTube allows its videos only in a visible player: without the video the song goes on from another service.
              <button className="icon-btn" onClick={youtubeHide} aria-label="Слушать без видео" title="Слушать без видео">
                <Icon name="videocam_off" />
              </button>
            )}
            <DislikeButton track={track} />
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
            <Link to={`/tracks/${track.id}`} replace className="action-btn" title="Страница трека: о песне и комментарии">
              <Icon name="info" size={20} />
              <span>О треке</span>
            </Link>
            <button className="action-btn" title="Скопировать ссылку" onClick={() => shareTrack(track)}>
              <Icon name="link" size={20} />
              <span>Ссылка</span>
            </button>
            <Volume />
          </div>
        </div>
        {column && <NowPlayingLyrics key={track.id} track={track} lyrics={lyrics} />}
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
