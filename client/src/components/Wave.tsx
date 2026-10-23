import { useState } from 'react';
import type { Track } from '../api/types';
import { useFetch } from '../lib/useFetch';
import { usePlayer } from '../store/player';
import { useWave, WAVE_MODES } from '../store/wave';
import { Icon } from './Icon';
import { Loading } from './States';
import { TrackRow } from './TrackRow';

/** «Моя волна» on the home page: one button for an endless stream picked for the listener, and its character. */
export function WaveCard() {
  const { mode, starting, start } = useWave();
  const active = usePlayer((s) => s.queueOrigin === 'wave');
  const playing = usePlayer((s) => s.queueOrigin === 'wave' && s.playing);
  const toggle = usePlayer((s) => s.toggle);

  return (
    <section className={`wave-card ${playing ? 'wave-card-playing' : ''}`} aria-label="Моя волна">
      <div className="wave-card-glow" aria-hidden />
      <button
        className="wave-play"
        onClick={() => (active ? toggle() : void start())}
        disabled={starting}
        aria-label={playing ? 'Пауза' : 'Слушать Мою волну'}
      >
        {starting ? <Icon name="progress_activity" size={36} className="spin" /> : <Icon name={playing ? 'pause' : 'play_arrow'} size={40} filled />}
      </button>
      <div className="wave-card-text">
        <h2>Моя волна</h2>
        <p>Бесконечный поток музыки под ваш вкус: похожее на то, что вы слушаете, лайкаете и на кого подписаны.</p>
        <div className="chips wave-modes" role="group" aria-label="Характер волны">
          {WAVE_MODES.map((m) => (
            <button
              key={m.id}
              className={`chip ${mode === m.id ? 'chip-selected' : ''}`}
              aria-pressed={mode === m.id}
              disabled={starting}
              // A character starts the wave in it (the one already playing goes on).
              onClick={() => (active && mode === m.id ? undefined : void start(m.id))}
            >
              {mode === m.id && <Icon name="check" size={18} />}
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** «Не нравится» for the song «Моя волна» is playing; nothing for any other queue. */
export function DislikeButton({ track, size = 24 }: { track: Track; size?: number }) {
  const active = usePlayer((s) => s.queueOrigin === 'wave');
  const dislike = useWave((s) => s.dislike);
  if (!active) return null;
  return (
    <button className="icon-btn" onClick={() => void dislike(track)} aria-label="Не нравится" title="Не нравится: убрать из волны">
      <Icon name="thumb_down" size={size} />
    </button>
  );
}

const SHOWN = 6;

/** «Рекомендации для вас» in the feed: songs the wave would pick, kept for half an hour on the server. */
export function Recommendations() {
  const [round, setRound] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const { data, loading } = useFetch<{ tracks: Track[] }>(round ? `/recommendations?refresh=1&round=${round}` : '/recommendations');
  const tracks = data?.tracks ?? [];
  if (!loading && !tracks.length) return null;
  return (
    <section className="section recommendations">
      <div className="section-header">
        <h2>Рекомендации для вас</h2>
        <button className="btn btn-text btn-small" onClick={() => setRound(round + 1)} disabled={loading}>
          <Icon name="refresh" size={18} className={loading ? 'spin' : ''} /> Обновить
        </button>
      </div>
      {loading && !tracks.length ? (
        <Loading />
      ) : (
        <div className="recommendations-list">
          {(expanded ? tracks : tracks.slice(0, SHOWN)).map((t) => (
            // Played from here, they go on as «Моя волна»: whole songs, and more of them as the list runs out.
            <TrackRow key={t.id} track={t} queue={tracks} origin="wave" />
          ))}
        </div>
      )}
      {tracks.length > SHOWN && (
        <button className="btn btn-text btn-small" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Свернуть' : 'Показать ещё'}
        </button>
      )}
    </section>
  );
}
