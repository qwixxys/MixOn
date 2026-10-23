import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/format';
import { useNowPlaying } from '../lib/nowPlaying';
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

/** The seek slider; `stacked` puts the times under it, as in the full-screen player. */
export function Progress({ stacked = false }: { stacked?: boolean }) {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const slider = (
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
  );
  if (stacked) {
    return (
      <div className="player-progress player-progress-stacked">
        {slider}
        <div className="player-times">
          <span className="player-time">{formatTime(currentTime)}</span>
          <span className="player-time">{formatTime(duration)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="player-progress">
      <span className="player-time">{formatTime(currentTime)}</span>
      {slider}
      <span className="player-time">{formatTime(duration)}</span>
    </div>
  );
}

/** Thin progress line along the bottom of the phone mini player: tap or drag along it to seek. */
function MiniProgress() {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  /** Where the finger is while dragging (0–1); the track seeks when it is lifted. */
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
  };
  const fraction = drag ?? (duration ? Math.min(1, currentTime / duration) : 0);

  return (
    <div
      className={`player-mini-progress ${drag !== null ? 'is-dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Позиция воспроизведения"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatTime(currentTime)} из ${formatTime(duration)}`}
      onPointerDown={(e) => {
        if (!duration || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e));
      }}
      onPointerMove={(e) => drag !== null && setDrag(at(e))}
      onPointerUp={(e) => {
        if (drag === null) return;
        seek(at(e) * duration);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
        if (!step || !duration) return;
        e.preventDefault();
        seek(Math.min(duration, Math.max(0, currentTime + step)));
      }}
    >
      <span className="player-mini-line">
        <span style={{ width: `${fraction * 100}%` }} />
      </span>
      {drag !== null && (
        <span className="player-mini-time" style={{ left: `clamp(32px, ${fraction * 100}%, calc(100% - 32px))` }}>
          {formatTime(fraction * duration)}
        </span>
      )}
    </div>
  );
}

export function Volume() {
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

/** The play queue, the current track highlighted; earlier tracks are dimmed. */
export function QueueList({ className = '' }: { className?: string }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const remove = usePlayer((s) => s.removeFromQueue);
  const ref = useRef<HTMLDivElement>(null);
  // Opens at the current track rather than at the start of a long queue (once, not on every track change).
  useEffect(() => {
    const list = ref.current;
    const current = list?.children[index] as HTMLElement | undefined;
    if (list && current) list.scrollTop += current.getBoundingClientRect().top - list.getBoundingClientRect().top;
  }, []);
  return (
    <div className={`queue-list ${className}`} ref={ref}>
      {queue.map((t, i) => (
        <div key={`${t.id}-${i}`} className={i < index ? 'queue-past' : ''}>
          <TrackRow track={t} queue={queue} compact onRemove={i === index ? undefined : () => remove(i)} />
        </div>
      ))}
    </div>
  );
}

export function clearQueue() {
  const { current } = usePlayer.getState();
  usePlayer.setState({ queue: current ? [current] : [], index: current ? 0 : -1 });
}

function QueuePanel({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, onClose);

  return (
    <div className="queue" ref={ref}>
      <div className="queue-header">
        <h3>Очередь</h3>
        <button className="btn btn-small btn-text" onClick={clearQueue}>
          Очистить
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть очередь">
          <Icon name="close" />
        </button>
      </div>
      <QueueList />
    </div>
  );
}

/** Shuffle, previous, play/pause, next and repeat. */
export function PlayerControls({ size = 24 }: { size?: number }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const repeatLabel = repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен';

  return (
    <div className="player-controls">
      <button className={`icon-btn player-secondary ${shuffle ? 'icon-btn-selected' : ''}`} onClick={toggleShuffle} aria-label="Перемешать" aria-pressed={shuffle}>
        <Icon name="shuffle" size={size} />
      </button>
      <button className="icon-btn player-secondary" onClick={prev} aria-label="Предыдущий">
        <Icon name="skip_previous" size={size} filled />
      </button>
      <button className={`icon-btn player-main-btn ${playing ? 'is-playing' : ''}`} onClick={toggle} aria-label={playing ? 'Пауза' : 'Играть'}>
        {loading && !playing ? (
          <Icon name="progress_activity" size={size} className="spin" />
        ) : playing ? (
          <Icon name="pause" size={size} filled />
        ) : (
          <Icon name="play_arrow" size={size} filled />
        )}
      </button>
      <button className="icon-btn" onClick={() => next()} aria-label="Следующий">
        <Icon name="skip_next" size={size} filled />
      </button>
      <button className={`icon-btn player-secondary ${repeat !== 'off' ? 'icon-btn-selected' : ''}`} onClick={cycleRepeat} aria-label={repeatLabel} title={repeatLabel}>
        {repeat === 'one' ? <Icon name="repeat_one" size={size} /> : <Icon name="repeat" size={size} />}
      </button>
    </div>
  );
}

const COMPACT = window.matchMedia('(max-width: 720px)');

export function PlayerBar() {
  const current = usePlayer((s) => s.current);
  const error = usePlayer((s) => s.error);
  const [queueOpen, setQueueOpen] = useState(false);
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const nowPlaying = useNowPlaying();

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
      <div
        className="player-inner"
        onClick={(e) => {
          // On phones the whole mini player opens the full-screen one, apart from its buttons.
          if (!COMPACT.matches || (e.target as Element).closest('button, a, input, [role="slider"]')) return;
          nowPlaying.show();
        }}
      >
        <button type="button" className="player-track" onClick={nowPlaying.show} title="Развернуть плеер">
          <Cover url={current.coverUrl} seed={current.id} size={48} />
          <span className="player-track-text">
            <span className="player-title">{current.title}</span>
            {error ? (
              <span className="player-error small" title={error}>
                {error}
              </span>
            ) : (
              <span className="player-artist">
                <span className="player-artist-name">{current.artist}</span>
                {current.source !== 'local' && <ServiceBadge source={current.source} preview={current.isPreview} />}
                {current.isPreview && <span className="player-preview">· отрывок 30 с</span>}
              </span>
            )}
          </span>
        </button>

        <PlayerControls />
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
          <button className="icon-btn player-expand" onClick={nowPlaying.show} aria-label="Развернуть плеер" title="Развернуть плеер">
            <Icon name="open_in_full" size={22} />
          </button>
        </div>
      </div>
      <MiniProgress />
      {queueOpen && <QueuePanel onClose={closeQueue} />}
    </div>
  );
}
