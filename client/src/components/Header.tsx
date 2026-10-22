import { Library, LogOut, Radio, Search, Upload, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useDismiss } from '../lib/useDismiss';
import { useAuth } from '../store/auth';
import { useLikes } from '../store/likes';
import { Avatar } from './Cover';
import { NotificationsMenu } from './NotificationsMenu';

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="soundFy — на главную">
      <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--accent)" />
        <g fill="#fff">
          <rect x="12" y="28" width="5" height="12" rx="2.5" />
          <rect x="20" y="20" width="5" height="28" rx="2.5" />
          <rect x="28" y="14" width="5" height="40" rx="2.5" />
          <rect x="36" y="22" width="5" height="24" rx="2.5" />
          <rect x="44" y="26" width="5" height="16" rx="2.5" />
        </g>
      </svg>
      <span>soundFy</span>
    </Link>
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
      <Search size={16} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск треков, артистов, людей" aria-label="Поиск" />
    </form>
  );
}

function UserMenu() {
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
      <button className="user-btn" onClick={() => setOpen(!open)} aria-label="Меню пользователя">
        <Avatar url={user.avatarUrl} name={user.displayName} size={30} />
      </button>
      {open && (
        <div className="menu-panel menu-panel-narrow" onClick={close}>
          <div className="menu-title">{user.displayName}</div>
          <Link to={`/users/${user.username}`} className="menu-item">
            <User size={16} /> Профиль
          </Link>
          <Link to="/library" className="menu-item">
            <Library size={16} /> Медиатека
          </Link>
          <Link to="/sync" className="menu-item">
            <Radio size={16} /> Сервисы и артисты
          </Link>
          <button
            className="menu-item"
            onClick={() => {
              logout();
              resetLikes();
              navigate('/');
            }}
          >
            <LogOut size={16} /> Выйти
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const user = useAuth((s) => s.user);
  return (
    <header className="header">
      <div className="header-inner">
        <Logo />
        <nav className="nav">
          <NavLink to="/" end>
            Главная
          </NavLink>
          <NavLink to="/discover">Обзор</NavLink>
          <NavLink to="/library">Медиатека</NavLink>
          <NavLink to="/sync">Сервисы</NavLink>
        </nav>
        <SearchBox />
        <div className="header-actions">
          {user ? (
            <>
              <Link to="/upload" className="btn btn-ghost header-upload">
                <Upload size={16} /> <span>Загрузить</span>
              </Link>
              <NotificationsMenu />
              <UserMenu />
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">
                Войти
              </Link>
              <Link to="/register" className="btn btn-primary">
                Регистрация
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
