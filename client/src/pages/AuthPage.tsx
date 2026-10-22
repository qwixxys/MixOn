import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
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
        <h1>{mode === 'login' ? 'Вход в soundFy' : 'Создать аккаунт'}</h1>
        <p className="muted">
          {mode === 'login'
            ? 'Слушайте, загружайте и следите за новыми релизами любимых артистов.'
            : 'Аккаунт нужен, чтобы загружать треки, собирать плейлисты и подписываться на артистов в ВК Музыке, Deezer и других сервисах.'}
        </p>
        {mode === 'login' ? (
          <label className="field">
            <span>Логин или email</span>
            <input className="input" value={form.login} onChange={set('login')} autoComplete="username" required autoFocus />
          </label>
        ) : (
          <>
            <label className="field">
              <span>Имя пользователя</span>
              <input className="input" value={form.username} onChange={set('username')} autoComplete="username" required autoFocus pattern="[A-Za-z0-9_.\-]{3,30}" title="3–30 символов: латиница, цифры, точка, дефис, подчёркивание" />
            </label>
            <label className="field">
              <span>Отображаемое имя</span>
              <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Как вас будут видеть другие" maxLength={60} />
            </label>
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
            </label>
          </>
        )}
        <label className="field">
          <span>Пароль</span>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 6 : undefined}
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
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
      </form>
    </div>
  );
}
