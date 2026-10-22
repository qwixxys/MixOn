import { gradientFor } from '../lib/gradient';
import { Icon } from './Icon';

export function Cover({ url, seed, size, className = '' }: { url: string | null; seed: string | number; size?: number; className?: string }) {
  return (
    <div
      className={`cover ${className}`}
      style={{ background: gradientFor(seed), ...(size ? { width: size, height: size } : {}) }}
    >
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon name="music_note" size={null} className="cover-icon" />}
    </div>
  );
}

export function Avatar({ url, name, size = 32 }: { url: string | null; name: string; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size, background: gradientFor(name), fontSize: size * 0.42 }}>
      {url ? <img src={url} alt="" loading="lazy" /> : name.slice(0, 1).toUpperCase()}
    </div>
  );
}
