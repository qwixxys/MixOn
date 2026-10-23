import { Link } from 'react-router';
import type { Track } from '../api/types';
import { formatTime } from '../lib/format';
import { useDownloads } from '../store/downloads';
import { usePlayer, sameTrack } from '../store/player';
import { Cover } from './Cover';
import { LikeButton } from './LikeButton';
import { PreviewNote, ServiceBadge } from './ServiceBadge';
import { Icon } from './Icon';

/** Compact single-line track entry for playlists, queues and sidebars. */
export function TrackRow({
  track,
  queue,
  index,
  onRemove,
  compact = false,
  origin,
}: {
  track: Track;
  queue?: Track[];
  index?: number;
  onRemove?: () => void;
  compact?: boolean;
  /** «wave»: the list goes on as «Моя волна» once it has been played through. */
  origin?: 'wave';
}) {
  const isCurrent = usePlayer((s) => sameTrack(s.current, track.id));
  const playing = usePlayer((s) => sameTrack(s.current, track.id) && s.playing);
  const play = usePlayer((s) => s.play);
  const saved = useDownloads((s) => Boolean(s.saved[track.id]));

  return (
    <div className={`track-row ${isCurrent ? 'is-current' : ''} ${compact ? 'track-row-compact' : ''}`}>
      <button className="track-row-cover" onClick={() => play(track, queue, undefined, origin)} aria-label={playing ? 'Пауза' : 'Слушать'}>
        <Cover url={track.coverUrl} seed={track.id} />
        <span className="track-row-overlay">{playing ? <Icon name="pause" size={18} filled /> : <Icon name="play_arrow" size={18} filled />}</span>
      </button>
      {index !== undefined && <span className="track-row-index">{index + 1}</span>}
      <div className="track-row-main">
        <Link to={`/tracks/${track.id}`} className="track-row-title" title={track.title}>
          {track.title}
        </Link>
        <span className="track-row-artist">
          {saved && <Icon name="download_done" size={14} className="track-row-saved" />}
          {track.artist}
        </span>
        <PreviewNote track={track} />
      </div>
      {!compact && <ServiceBadge source={track.source} preview={track.isPreview} />}
      {!compact && <LikeButton track={track} small />}
      {!compact && <span className="muted small track-row-duration">{formatTime(track.duration)}</span>}
      {onRemove && (
        <button className="icon-btn" onClick={onRemove} title="Убрать">
          <Icon name="close" size={20} />
        </button>
      )}
    </div>
  );
}
