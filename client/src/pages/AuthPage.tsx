import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LogoMark } from '../components/Header';
import { TextField } from '../components/Material';
import { changeServer, inAndroidApp } from '../lib/androidApp';
import { useAuth } from '../store/auth';
import { useLikes } from '../store/likes';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const user = useAuth((s) => s.user);
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const resetLikes = useLikes((s) => s.reset);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/';
  const [form, setForm] = useState({ login: '', username: '', email: '', password: '', displayName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(form.login, form.password);
      else
        await register({
          username: form.username,
          email: form.email,
          password: form.password,
          displayName: form.displayName || undefined,
        });
      resetLikes();
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page auth-page">
      <form className="auth-card" onSubmit={submit}>
        <LogoMark size={48} />
        <h1>{mode === 'login' ? 'Вход в soundFy' : 'Создать аккаунт'}</h1>
        <p className="muted">
          {mode === 'login'
            ? 'Слушайте, загружайте и следите за новыми релизами любимых артистов.'
            : 'Аккаунт нужен, чтобы загружать треки, собирать плейлисты и подписываться на артистов в SoundCloud, ВК Музыке, Deezer и других сервисах.'}
        </p>
        {mode === 'login' ? (
          <TextField label="Логин или email" value={form.login} onChange={set('login')} autoComplete="username" required autoFocus />
        ) : (
          <>
            <TextField
              label="Имя пользователя"
              value={form.username}
              onChange={set('username')}
              autoComplete="username"
              required
              autoFocus
              pattern="[A-Za-z0-9_.\-]{3,30}"
              title="3–30 символов: латиница, цифры, точка, дефис, подчёркивание"
              supportingText="Латиница, цифры, точка, дефис и подчёркивание"
            />
            <TextField label="Отображаемое имя" value={form.displayName} onChange={set('displayName')} hint="Как вас будут видеть другие" maxLength={60} />
            <TextField label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          </>
        )}
        <TextField
          label="Пароль"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'register' ? 6 : undefined}
          supportingText={mode === 'register' ? 'Не меньше 6 символов' : undefined}
          required
        />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-filled btn-large" disabled={busy}>
          {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
        </button>
        <p className="muted center">
          {mode === 'login' ? (
            <>
              Нет аккаунта? <Link to={`/register?next=${encodeURIComponent(next)}`}>Зарегистрируйтесь</Link>
            </>
          ) : (
            <>
              Уже есть аккаунт? <Link to={`/login?next=${encodeURIComponent(next)}`}>Войдите</Link>
            </>
          )}
        </p>
        {inAndroidApp && (
          <button type="button" className="btn btn-text" onClick={changeServer}>
            Сменить сервер
          </button>
        )}
      </form>
    </div>
  );
}
