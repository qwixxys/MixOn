import { Compass, House, Library, LogOut, Palette, Radio, Search, Upload, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useDismiss } from '../lib/useDismiss';
import { useAuth } from '../store/auth';
import { useLikes } from '../store/likes';
import { AppearanceDialog } from './AppearanceDialog';
import { Avatar } from './Cover';
import { NotificationsMenu } from './NotificationsMenu';

const DESTINATIONS = [
  { to: '/', label: 'Главная', icon: House, end: true },
  { to: '/discover', label: 'Обзор', icon: Compass, end: false },
  { to: '/library', label: 'Медиатека', icon: Library, end: false },
  { to: '/sync', label: 'Сервисы', icon: Radio, end: false },
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
    <Link to="/" className="logo" aria-label="soundFy — на главную">
      <LogoMark />
      <span className="logo-text">soundFy</span>
    </Link>
  );
}

function Destinations() {
  return (
    <>
      {DESTINATIONS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-indicator">
            <Icon size={22} />
          </span>
          <span>{label}</span>
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
      <Link to="/" className="rail-logo" aria-label="soundFy — на главную">
        <LogoMark size={44} />
      </Link>
      <Link to={user ? '/upload' : '/login?next=/upload'} className="fab" title="Загрузить трек" aria-label="Загрузить трек">
        <Upload size={24} />
      </Link>
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
      <Search size={22} />
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
            <User size={20} /> Профиль
          </Link>
          <Link to="/library" className="menu-item" role="menuitem">
            <Library size={20} /> Медиатека
          </Link>
          <Link to="/sync" className="menu-item" role="menuitem">
            <Radio size={20} /> Сервисы и артисты
          </Link>
          <button className="menu-item" role="menuitem" onClick={onAppearance}>
            <Palette size={20} /> Оформление
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              logout();
              resetLikes();
              navigate('/');
            }}
          >
            <LogOut size={20} /> Выйти
          </button>
        </div>
      )}
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
        <SearchBox />
        <div className="topbar-actions">
          {/* On phones signed-in users reach this from the account menu, which saves room for search. */}
          <button className={`icon-btn ${user ? 'topbar-hide-compact' : ''}`} onClick={() => setAppearance(true)} aria-label="Оформление" title="Оформление">
            <Palette size={22} />
          </button>
          {user ? (
            <>
              <Link to="/upload" className="icon-btn topbar-compact-only" aria-label="Загрузить трек" title="Загрузить трек">
                <Upload size={22} />
              </Link>
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
