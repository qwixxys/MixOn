import { serviceInfo } from '../lib/services';

export function ServiceBadge({ source, preview }: { source: string; preview?: boolean }) {
  if (source === 'local') return null;
  const info = serviceInfo(source);
  return (
    <span className="service-badge" style={{ color: info.color, borderColor: info.color }} title={`Трек из ${info.label}`}>
      {info.label}
      {preview && <span className="service-badge-preview"> · превью</span>}
    </span>
  );
}

export function ServiceIcon({ id, size = 40 }: { id: string; size?: number }) {
  const info = serviceInfo(id);
  return (
    <div className="service-icon" style={{ background: info.color, width: size, height: size, fontSize: size * 0.36 }}>
      {info.short || info.label.slice(0, 1)}
    </div>
  );
}
