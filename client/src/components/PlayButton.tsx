import type { Track } from '../api/types';
import { usePlayer, sameTrack } from '../store/player';
import { Icon } from './Icon';

/** Round orange play/pause button for a track; `queue` is what plays after it. */
export function PlayButton({ track, queue, size = 44 }: { track: Track; queue?: Track[]; size?: number }) {
  const isCurrent = usePlayer((s) => sameTrack(s.current, track.id));
  const playing = usePlayer((s) => sameTrack(s.current, track.id) && s.playing);
  const loading = usePlayer((s) => sameTrack(s.current, track.id) && s.loading && !s.playing);
  const play = usePlayer((s) => s.play);
  const icon = size * 0.45;

  return (
    <button
      className={`play-btn ${playing ? 'is-playing' : ''}`}
      style={{ width: size, height: size }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        play(track, queue);
      }}
      aria-label={playing ? 'Пауза' : 'Слушать'}
      title={playing ? 'Пауза' : 'Слушать'}
    >
      {loading && isCurrent ? (
        <Icon name="progress_activity" size={icon} className="spin" />
      ) : playing ? (
        <Icon name="pause" size={icon} filled />
      ) : (
        <Icon name="play_arrow" size={icon} filled className="play-icon" />
      )}
    </button>
  );
}
