import type { Track } from '../api/types';
import { SERVICE_LOGOS } from '../lib/serviceLogos';
import { serviceInfo } from '../lib/services';
import { Icon } from './Icon';

export function ServiceBadge({ source, preview }: { source: string; preview?: boolean }) {
  if (source === 'local') return null;
  const info = serviceInfo(source);
  return (
    <span className="service-badge" title={`Трек из ${info.label}`}>
      <span className="service-dot" style={{ background: info.color }} />
      {info.label}
      {preview && <span className="service-badge-preview">превью</span>}
    </span>
  );
}

/** The service's logo on its brand colour (initials for a service without one). */
export function ServiceIcon({ id, size = 40 }: { id: string; size?: number }) {
  const info = serviceInfo(id);
  const logo = SERVICE_LOGOS[id];
  return (
    <div
      className="service-icon"
      style={{ background: info.color, color: info.ink ?? '#fff', width: size, height: size, fontSize: size * 0.36 }}
      title={info.label}
    >
      {logo ? (
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} fill="currentColor" aria-hidden>
          <path d={logo} />
        </svg>
      ) : (
        info.short || info.label.slice(0, 1)
      )}
    </div>
  );
}

/** Deezer and Apple Music let anyone hear only 30 seconds of a track; said under each such track. */
export function PreviewNote({ track }: { track: Pick<Track, 'source' | 'isPreview'> }) {
  if (!track.isPreview) return null;
  return (
    <span
      className="preview-note"
      title={`${serviceInfo(track.source).label} без подписки даёт послушать только 30 секунд. Целиком — в ВК Музыке, SoundCloud и YouTube`}
    >
      <Icon name="timer" size={14} />
      30-секундный отрывок
    </span>
  );
}
