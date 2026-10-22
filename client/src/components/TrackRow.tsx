import { Pause, Play, X } from 'lucide-react';
import { Link } from 'react-router';
import type { Track } from '../api/types';
import { formatTime } from '../lib/format';
import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { LikeButton } from './LikeButton';
import { ServiceBadge } from './ServiceBadge';

/** Compact single-line track entry for playlists, queues and sidebars. */
export function TrackRow({
  track,
  queue,
  index,
  onRemove,
  compact = false,
}: {
  track: Track;
  queue?: Track[];
  index?: number;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const isCurrent = usePlayer((s) => s.current?.id === track.id);
  const playing = usePlayer((s) => s.current?.id === track.id && s.playing);
  const play = usePlayer((s) => s.play);

  return (
    <div className={`track-row ${isCurrent ? 'is-current' : ''} ${compact ? 'track-row-compact' : ''}`}>
      <button className="track-row-cover" onClick={() => play(track, queue)} aria-label={playing ? 'Пауза' : 'Слушать'}>
        <Cover url={track.coverUrl} seed={track.id} />
        <span className="track-row-overlay">{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</span>
      </button>
      {index !== undefined && <span className="track-row-index">{index + 1}</span>}
      <div className="track-row-main">
        <Link to={`/tracks/${track.id}`} className="track-row-title" title={track.title}>
          {track.title}
        </Link>
        <span className="track-row-artist">{track.artist}</span>
      </div>
      {!compact && <ServiceBadge source={track.source} preview={track.isPreview} />}
      {!compact && <LikeButton track={track} small />}
      {!compact && <span className="muted small track-row-duration">{formatTime(track.duration)}</span>}
      {onRemove && (
        <button className="icon-btn" onClick={onRemove} title="Убрать">
          <X size={16} />
        </button>
      )}
    </div>
  );
}
