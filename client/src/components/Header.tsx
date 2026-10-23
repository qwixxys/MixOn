import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router';
import { changeServer, inAndroidApp } from '../lib/androidApp';
import { STANDALONE } from '../lib/standalone';
import { useDismiss } from '../lib/useDismiss';
import { useAuth } from '../store/auth';
import { useLikes } from '../store/likes';
import { AppearanceDialog } from './AppearanceDialog';
import { Avatar } from './Cover';
import { NotificationsMenu } from './NotificationsMenu';
import { Icon, type IconName } from './Icon';

const DESTINATIONS: { to: string; label: string; icon: IconName; end: boolean }[] = [
  { to: '/', label: 'Главная', icon: 'home', end: true },
  { to: '/discover', label: 'Обзор', icon: 'explore', end: false },
  { to: '/library', label: 'Медиатека', icon: 'library_music', end: false },
  { to: '/sync', label: 'Сервисы', icon: 'hub', end: false },
];

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 64 64" width={size * 0.7} height={size * 0.7} fill="currentColor">
        <rect x="10" y="26" width="6" height="12" rx="3" />
        <rect x="20" y="18" width="6" height="28" rx="3" />
        <rect x="30" y="10" width="6" height="44" rx="3" />
        <rect x="40" y="20" width="6" height="24" rx="3" />
        <rect x="50" y="26" width="6" height="12" rx="3" />
      </svg>
    </span>
  );
}

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="MixOn — на главную">
      <LogoMark />
      <span className="logo-text">MixOn</span>
    </Link>
  );
}

function Destinations() {
  return (
    <>
      {DESTINATIONS.map(({ to, label, icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          {({ isActive }) => (
            <>
              <span className="nav-indicator">
                <Icon name={icon} filled={isActive} />
              </span>
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

/** MD3 navigation rail for medium and expanded windows. */
export function NavRail() {
  const user = useAuth((s) => s.user);
  return (
    <nav className="rail" aria-label="Разделы">
      <Link to="/" className="rail-logo" aria-label="MixOn — на главную">
        <LogoMark size={44} />
      </Link>
      {!STANDALONE && (
        <Link to={user ? '/upload' : '/login?next=/upload'} className="fab" title="Загрузить трек" aria-label="Загрузить трек">
          <Icon name="upload" size={24} />
        </Link>
      )}
      <div className="rail-destinations">
        <Destinations />
      </div>
    </nav>
  );
}

/** MD3 navigation bar for compact (phone) windows. */
export function NavBar() {
  return (
    <nav className="navbar" aria-label="Разделы">
      <Destinations />
    </nav>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (location.pathname === '/search') setQ(params.get('q') ?? '');
  }, [location.pathname, params]);

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Icon name="search" size={24} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск треков, артистов, людей" aria-label="Поиск" />
    </form>
  );
}

function UserMenu({ onAppearance }: { onAppearance(): void }) {
  const user = useAuth((s) => s.user)!;
  const logout = useAuth((s) => s.logout);
  const resetLikes = useLikes((s) => s.reset);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const navigate = useNavigate();

  return (
    <div className="menu" ref={ref}>
      <button className="user-btn" onClick={() => setOpen(!open)} aria-label="Меню пользователя" aria-expanded={open}>
        <Avatar url={user.avatarUrl} name={user.displayName} size={32} />
      </button>
      {open && (
        <div className="menu-panel menu-panel-narrow" onClick={close} role="menu">
          <div className="menu-title">{user.displayName}</div>
          <Link to={`/users/${user.username}`} className="menu-item" role="menuitem">
            <Icon name="person" size={24} /> Профиль
          </Link>
          <Link to="/library" className="menu-item" role="menuitem">
            <Icon name="library_music" size={24} /> Медиатека
          </Link>
          <Link to="/sync" className="menu-item" role="menuitem">
            <Icon name="hub" size={24} /> Сервисы
          </Link>
          <button className="menu-item" role="menuitem" onClick={onAppearance}>
            <Icon name="palette" size={24} /> Оформление
          </button>
          {inAndroidApp && (
            <button className="menu-item" role="menuitem" onClick={changeServer}>
              <Icon name="link" size={24} /> {STANDALONE ? 'Подключиться к серверу' : 'Сменить сервер'}
            </button>
          )}
          {/* The standalone app has one account on the device, which stays signed in. */}
          {!STANDALONE && (
            <button
              className="menu-item"
              role="menuitem"
              onClick={() => {
                logout();
                resetLikes();
                navigate('/');
              }}
            >
              <Icon name="logout" size={24} /> Выйти
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const FURTHEST_KEY = 'soundfy.historyFurthest';

/** The position of the current page in this tab's history, as React Router numbers it. */
const historyIndex = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;

/**
 * Back and forward through the pages, like a browser's buttons, which the desktop app does not have. Forward is there
 * while the pages gone back from are still ahead (opening another page drops them, as in a browser).
 */
function HistoryArrows() {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  const index = historyIndex();
  const [furthest, setFurthest] = useState(() => {
    try {
      return Number(sessionStorage.getItem(FURTHEST_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    setFurthest((known) => {
      const next = type === 'PUSH' ? index : Math.max(known, index);
      try {
        sessionStorage.setItem(FURTHEST_KEY, String(next));
      } catch {
        // storage unavailable: forward is offered until a reload
      }
      return next;
    });
    // Every move through the history has its own key.
  }, [location.key, type, index]);

  return (
    <div className="history-arrows topbar-hide-compact">
      <button className="icon-btn" onClick={() => navigate(-1)} disabled={index <= 0} aria-label="Назад" title="Назад">
        <Icon name="chevron_left" size={28} />
      </button>
      <button className="icon-btn" onClick={() => navigate(1)} disabled={index >= furthest} aria-label="Вперёд" title="Вперёд">
        <Icon name="chevron_right" size={28} />
      </button>
    </div>
  );
}

/** MD3 top app bar: search, appearance, notifications and account. Changes colour once content scrolls under it. */
export function TopAppBar() {
  const user = useAuth((s) => s.user);
  const [scrolled, setScrolled] = useState(false);
  const [appearance, setAppearance] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
      <div className="topbar-inner">
        <span className="topbar-logo">
          <Logo />
        </span>
        <HistoryArrows />
        <SearchBox />
        <div className="topbar-actions">
          {/* On phones signed-in users reach this from the account menu, which saves room for search. */}
          <button className={`icon-btn ${user ? 'topbar-hide-compact' : ''}`} onClick={() => setAppearance(true)} aria-label="Оформление" title="Оформление">
            <Icon name="palette" size={24} />
          </button>
          {user ? (
            <>
              {!STANDALONE && (
                <Link to="/upload" className="icon-btn topbar-compact-only" aria-label="Загрузить трек" title="Загрузить трек">
                  <Icon name="upload" size={24} />
                </Link>
              )}
              <NotificationsMenu />
              <UserMenu onAppearance={() => setAppearance(true)} />
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-text">
                Войти
              </Link>
              <Link to="/register" className="btn btn-filled topbar-hide-compact">
                Регистрация
              </Link>
            </>
          )}
        </div>
      </div>
      {appearance && <AppearanceDialog onClose={() => setAppearance(false)} />}
    </header>
  );
}
