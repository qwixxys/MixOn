import {
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatTime } from '../lib/format';
import { useDismiss } from '../lib/useDismiss';
import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { LikeButton } from './LikeButton';
import { ServiceBadge } from './ServiceBadge';
import { TrackRow } from './TrackRow';

function rangeStyle(value: number, max: number) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return { '--fill': `${pct}%` } as React.CSSProperties;
}

function Progress() {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  return (
    <div className="player-progress">
      <span className="player-time">{formatTime(currentTime)}</span>
      <input
        type="range"
        className="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => seek(Number(e.target.value))}
        style={rangeStyle(currentTime, duration)}
        aria-label="Позиция воспроизведения"
      />
      <span className="player-time">{formatTime(duration)}</span>
    </div>
  );
}

function Volume() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const shown = muted ? 0 : volume;
  return (
    <div className="player-volume">
      <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
        <Icon size={18} />
      </button>
      <input
        type="range"
        className="range range-small"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        onChange={(e) => setVolume(Number(e.target.value))}
        style={rangeStyle(shown, 1)}
        aria-label="Громкость"
      />
    </div>
  );
}

function QueuePanel({ onClose }: { onClose(): void }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const remove = usePlayer((s) => s.removeFromQueue);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, onClose);
  const clear = () => {
    const { current } = usePlayer.getState();
    usePlayer.setState({ queue: current ? [current] : [], index: current ? 0 : -1 });
  };

  return (
    <div className="queue" ref={ref}>
      <div className="queue-header">
        <h3>Очередь</h3>
        <button className="btn btn-small btn-ghost" onClick={clear}>
          Очистить
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть очередь">
          <X size={18} />
        </button>
      </div>
      <div className="queue-list">
        {queue.map((t, i) => (
          <div key={`${t.id}-${i}`} className={i < index ? 'queue-past' : ''}>
            <TrackRow track={t} queue={queue} compact onRemove={i === index ? undefined : () => remove(i)} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlayerBar() {
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const error = usePlayer((s) => s.error);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const [queueOpen, setQueueOpen] = useState(false);
  const closeQueue = useCallback(() => setQueueOpen(false), []);

  // Space toggles playback unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code !== 'Space' || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable) return;
      if (!usePlayer.getState().current) return;
      e.preventDefault();
      usePlayer.getState().toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!current) return null;

  return (
    <div className="player" role="region" aria-label="Плеер">
      <div className="player-inner">
        <div className="player-controls">
          <button className="icon-btn" onClick={prev} aria-label="Предыдущий">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button className="icon-btn player-main-btn" onClick={toggle} aria-label={playing ? 'Пауза' : 'Играть'}>
            {loading && !playing ? (
              <LoaderCircle size={22} className="spin" />
            ) : playing ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play size={22} fill="currentColor" />
            )}
          </button>
          <button className="icon-btn" onClick={() => next()} aria-label="Следующий">
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button className={`icon-btn ${shuffle ? 'icon-btn-active' : ''}`} onClick={toggleShuffle} aria-label="Перемешать" aria-pressed={shuffle}>
            <Shuffle size={17} />
          </button>
          <button
            className={`icon-btn ${repeat !== 'off' ? 'icon-btn-active' : ''}`}
            onClick={cycleRepeat}
            aria-label={repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'}
            title={repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'}
          >
            {repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>

        <Progress />
        <Volume />

        <div className="player-track">
          <Link to={`/tracks/${current.id}`}>
            <Cover url={current.coverUrl} seed={current.id} size={40} />
          </Link>
          <div className="player-track-text">
            {error ? (
              <span className="player-error" title={error}>
                {error}
              </span>
            ) : (
              <span className="player-artist">
                {current.artist} <ServiceBadge source={current.source} preview={current.isPreview} />
              </span>
            )}
            <Link to={`/tracks/${current.id}`} className="player-title" title={current.title}>
              {current.title}
            </Link>
          </div>
          <LikeButton track={current} showCount={false} />
          <button
            className={`icon-btn ${queueOpen ? 'icon-btn-active' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setQueueOpen(!queueOpen)}
            aria-label="Очередь"
            title="Очередь"
          >
            <ListMusic size={19} />
          </button>
        </div>
      </div>
      {queueOpen && <QueuePanel onClose={closeQueue} />}
    </div>
  );
}
