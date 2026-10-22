import { Bell } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { Notification } from '../api/types';
import { timeAgo } from '../lib/format';
import { useDismiss } from '../lib/useDismiss';
import { Cover } from './Cover';
import { PlayButton } from './PlayButton';
import { Loading } from './States';

const POLL_MS = 60_000;

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api<{ count: number }>('/me/notifications/unread-count')
        .then((r) => alive && setUnread(r.count))
        .catch(() => {});
    poll();
    const timer = setInterval(poll, POLL_MS);
    const onSync = () => poll();
    window.addEventListener('soundfy:synced', onSync);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('soundfy:synced', onSync);
    };
  }, []);

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setItems(null);
    try {
      const list = await api<Notification[]>('/me/notifications?limit=20');
      setItems(list);
      if (unread) {
        await api('/me/notifications/read', { method: 'POST' });
        setUnread(0);
      }
    } catch {
      setItems([]);
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" onClick={toggle} aria-label="Уведомления" title="Уведомления">
        <Bell size={22} />
        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="menu-panel notifications">
          <div className="menu-title">Уведомления</div>
          {!items && <Loading />}
          {items && !items.length && (
            <p className="muted notifications-empty">
              Здесь появятся новые релизы артистов, на которых вы подписаны в <Link to="/sync" onClick={close}>сервисах</Link>, и
              загрузки людей, на которых вы подписаны.
            </p>
          )}
          {items?.map((n) => (
            <div key={n.id} className={`notification ${n.isRead ? '' : 'notification-unread'}`}>
              <Cover url={n.track.coverUrl} seed={n.track.id} size={44} />
              <div className="notification-main">
                <span className="small muted">
                  {n.type === 'new_release' ? 'Новый релиз' : `${n.track.uploader?.displayName ?? n.track.artist} загрузил(а) трек`} ·{' '}
                  {timeAgo(n.createdAt)}
                </span>
                <Link to={`/tracks/${n.track.id}`} onClick={close} className="notification-title">
                  {n.track.artist} — {n.track.title}
                </Link>
              </div>
              <PlayButton track={n.track} queue={items.map((i) => i.track)} size={32} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
