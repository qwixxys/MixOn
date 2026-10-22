import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatTime } from '../lib/format';
import { useDismiss } from '../lib/useDismiss';
import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { LikeButton } from './LikeButton';
import { ServiceBadge } from './ServiceBadge';
import { TrackRow } from './TrackRow';
import { Icon } from './Icon';

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

/** Thin progress line shown on phones, where the full slider does not fit. */
function MiniProgress() {
  const fraction = usePlayer((s) => (s.duration ? Math.min(1, s.currentTime / s.duration) : 0));
  return (
    <div className="player-mini-progress" aria-hidden>
      <span style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

function Volume() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const icon = muted || volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up';
  const shown = muted ? 0 : volume;
  return (
    <div className="player-volume">
      <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
        <Icon name={icon} size={24} />
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
        <button className="btn btn-small btn-text" onClick={clear}>
          Очистить
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть очередь">
          <Icon name="close" />
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
        <div className="player-track">
          <Link to={`/tracks/${current.id}`}>
            <Cover url={current.coverUrl} seed={current.id} size={48} />
          </Link>
          <div className="player-track-text">
            <Link to={`/tracks/${current.id}`} className="player-title" title={current.title}>
              {current.title}
            </Link>
            {error ? (
              <span className="player-error small" title={error}>
                {error}
              </span>
            ) : (
              <span className="player-artist">
                {current.artist}
                {current.source !== 'local' && <ServiceBadge source={current.source} preview={current.isPreview} />}
              </span>
            )}
          </div>
        </div>

        <div className="player-controls">
          <button className={`icon-btn player-secondary ${shuffle ? 'icon-btn-selected' : ''}`} onClick={toggleShuffle} aria-label="Перемешать" aria-pressed={shuffle}>
            <Icon name="shuffle" size={24} />
          </button>
          <button className="icon-btn player-secondary" onClick={prev} aria-label="Предыдущий">
            <Icon name="skip_previous" size={24} filled />
          </button>
          <button className={`icon-btn player-main-btn ${playing ? 'is-playing' : ''}`} onClick={toggle} aria-label={playing ? 'Пауза' : 'Играть'}>
            {loading && !playing ? (
              <Icon name="progress_activity" size={24} className="spin" />
            ) : playing ? (
              <Icon name="pause" size={24} filled />
            ) : (
              <Icon name="play_arrow" size={24} filled />
            )}
          </button>
          <button className="icon-btn" onClick={() => next()} aria-label="Следующий">
            <Icon name="skip_next" size={24} filled />
          </button>
          <button
            className={`icon-btn player-secondary ${repeat !== 'off' ? 'icon-btn-selected' : ''}`}
            onClick={cycleRepeat}
            aria-label={repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'}
            title={repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'}
          >
            {repeat === 'one' ? <Icon name="repeat_one" size={24} /> : <Icon name="repeat" size={24} />}
          </button>
        </div>

        <Progress />
        <Volume />

        <div className="player-extra">
          <LikeButton track={current} showCount={false} small />
          <button
            className={`icon-btn ${queueOpen ? 'icon-btn-selected' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setQueueOpen(!queueOpen)}
            aria-label="Очередь"
            title="Очередь"
          >
            <Icon name="queue_music" size={24} />
          </button>
        </div>
      </div>
      <MiniProgress />
      {queueOpen && <QueuePanel onClose={closeQueue} />}
    </div>
  );
}
