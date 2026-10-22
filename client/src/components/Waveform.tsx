import { useRef, useState, type MouseEvent } from 'react';
import type { Comment } from '../api/types';
import { formatTime } from '../lib/format';
import { Avatar } from './Cover';

interface Props {
  peaks: number[];
  progress: number;
  onSeek?(fraction: number): void;
  height?: number;
  variant?: 'light' | 'dark';
  duration?: number;
  comments?: Comment[];
}

const BAR = 2;
const GAP = 1;

/** SoundCloud-style waveform: bars above a dimmer reflection, coloured up to the playback position. */
export function Waveform({ peaks, progress, onSeek, height = 60, variant = 'light', duration = 0, comments }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const bars = peaks.length ? peaks : Array.from({ length: 100 }, () => 0.3);
  const width = bars.length * (BAR + GAP);
  const top = height * 0.7;
  const bottom = height - top - 1;
  const played = Math.floor(progress * bars.length);
  const hovered = hover === null ? -1 : Math.floor(hover * bars.length);

  const fraction = (e: MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  return (
    <div
      ref={ref}
      className={`waveform waveform-${variant} ${onSeek ? 'waveform-seekable' : ''}`}
      style={{ height }}
      onClick={(e) => onSeek?.(fraction(e))}
      onMouseMove={(e) => onSeek && setHover(fraction(e))}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
        {bars.map((v, i) => {
          const h = Math.max(1, v * top);
          const cls = i < played ? 'wf-played' : i <= hovered ? 'wf-hover' : 'wf-idle';
          return (
            <g key={i} className={cls}>
              <rect x={i * (BAR + GAP)} y={top - h} width={BAR} height={h} />
              <rect className="wf-reflection" x={i * (BAR + GAP)} y={top + 1} width={BAR} height={Math.max(1, v * bottom)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && duration > 0 && (
        <span className="waveform-time" style={{ left: `${hover * 100}%` }}>
          {formatTime(hover * duration)}
        </span>
      )}
      {duration > 0 &&
        comments
          ?.filter((c) => c.atSeconds !== null && c.atSeconds <= duration)
          .slice(0, 60)
          .map((c) => (
            <span
              key={c.id}
              className="waveform-comment"
              style={{ left: `${((c.atSeconds ?? 0) / duration) * 100}%`, top: top - 10 }}
              title={`${c.user.displayName} на ${formatTime(c.atSeconds ?? 0)}: ${c.body}`}
            >
              <Avatar url={c.user.avatarUrl} name={c.user.displayName} size={18} />
            </span>
          ))}
    </div>
  );
}
