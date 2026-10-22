import { LoaderCircle, Pause, Play } from 'lucide-react';
import type { Track } from '../api/types';
import { usePlayer } from '../store/player';

/** Round orange play/pause button for a track; `queue` is what plays after it. */
export function PlayButton({ track, queue, size = 44 }: { track: Track; queue?: Track[]; size?: number }) {
  const isCurrent = usePlayer((s) => s.current?.id === track.id);
  const playing = usePlayer((s) => s.current?.id === track.id && s.playing);
  const loading = usePlayer((s) => s.current?.id === track.id && s.loading && !s.playing);
  const play = usePlayer((s) => s.play);
  const icon = size * 0.45;

  return (
    <button
      className="play-btn"
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
        <LoaderCircle size={icon} className="spin" />
      ) : playing ? (
        <Pause size={icon} fill="currentColor" />
      ) : (
        <Play size={icon} fill="currentColor" className="play-icon" />
      )}
    </button>
  );
}
