import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { Service, Track } from '../api/types';
import { serviceInfo } from '../lib/services';
import { useDismiss } from '../lib/useDismiss';
import { useFetch } from '../lib/useFetch';
import { usePlayer } from '../store/player';
import { usePlayVia } from '../store/playVia';
import { toast } from '../store/toasts';
import { Icon } from './Icon';
import { ServiceIcon } from './ServiceBadge';

/** On «Сервисы»: the service music plays through (store/playVia.ts). */
export function PlayViaPicker({ services }: { services: Service[] }) {
  const { via, setVia } = usePlayVia();
  // Only services that play whole tracks: picking Deezer or Apple Music would turn songs into 30-second previews.
  const full = services.filter((s) => s.fullTracks);
  const chosen = full.find((s) => s.id === via);
  return (
    <section className="play-via">
      <h2 className="play-via-title">
        <Icon name="headphones" /> Слушать через
      </h2>
      <p className="muted small">
        Песни из других сервисов — превью Deezer и Apple Music, релизы в ленте, импортированные плейлисты — MixOn найдёт в
        выбранном сервисе и включит оттуда. Если песни там нет, она играет там, где нашлась.
      </p>
      <div className="chips" role="group" aria-label="Слушать через">
        <button className={`chip ${!via ? 'chip-selected' : ''}`} aria-pressed={!via} onClick={() => setVia(null)}>
          {!via && <Icon name="check" size={18} />}
          Где нашлась
        </button>
        {full.map((s) => (
          <button
            key={s.id}
            className={`chip ${via === s.id ? 'chip-selected' : ''}`}
            aria-pressed={via === s.id}
            disabled={!s.available && via !== s.id}
            title={s.available ? undefined : 'Сначала подключите сервис ниже'}
            onClick={() => setVia(s.id)}
          >
            {via === s.id ? <Icon name="check" size={18} /> : <ServiceIcon id={s.id} size={18} />}
            {serviceInfo(s.id).label}
          </button>
        ))}
      </div>
      {chosen && !chosen.available && (
        <p className="small notice notice-warn">
          <Icon name="warning" size={18} />
          <span>{serviceInfo(chosen.id).label} не подключён, поэтому песни пока играют там, где нашлись.</span>
        </p>
      )}
    </section>
  );
}

/**
 * In the full-screen player: the service the track plays from, which opens a menu to play the same song from another
 * service instead.
 */
export function ListenOn({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const services = useFetch<Service[]>(open ? '/services' : null);
  const info = serviceInfo(track.source);
  const others = (services.data ?? []).filter((s) => s.fullTracks && s.available && s.id !== track.source);

  const switchTo = async (service: Service) => {
    setBusy(service.id);
    try {
      const version = await api<Track>(`/tracks/${track.id}/version?on=${encodeURIComponent(service.id)}`);
      const { current, currentTime, swapCurrent } = usePlayer.getState();
      if (current?.id === track.id) swapCurrent(version, version.isPreview || track.isPreview ? 0 : currentTime);
      close();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (track.source === 'local') return null;
  return (
    <div className="menu np-listen-on" ref={ref}>
      <button className="np-source" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="Слушать в другом сервисе">
        <span className="service-dot" style={{ background: info.color }} />
        {info.label}
        <Icon name="arrow_drop_down" size={18} />
      </button>
      {open && (
        <div className="menu-panel menu-panel-narrow np-listen-menu" role="menu">
          <div className="menu-title">Слушать в</div>
          {services.loading && (
            <p className="menu-note muted small">
              <Icon name="progress_activity" size={18} className="spin" /> Загрузка…
            </p>
          )}
          {services.data && !others.length && <p className="menu-note muted small">Других подключённых сервисов с полными треками нет.</p>}
          {others.map((s) => (
            <button key={s.id} className="menu-item" role="menuitem" disabled={busy !== null} onClick={() => void switchTo(s)}>
              {busy === s.id ? <Icon name="progress_activity" size={24} className="spin" /> : <ServiceIcon id={s.id} size={24} />}
              {serviceInfo(s.id).label}
            </button>
          ))}
          <Link to="/sync" replace className="menu-item" role="menuitem" onClick={close}>
            <Icon name="headphones" />
            Сервис по умолчанию…
          </Link>
        </div>
      )}
    </div>
  );
}
