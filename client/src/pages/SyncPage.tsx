import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { LoginStep, Service, ServiceKeyInfo } from '../api/types';
import { TextField } from '../components/Material';
import { ServiceIcon } from '../components/ServiceBadge';
import { KeyFlag, KeyForm, keyGuides } from '../components/ServiceKeys';
import { ErrorState, Loading } from '../components/States';
import { plural } from '../lib/format';
import { serviceInfo } from '../lib/services';
import { canSolveVkCaptcha, solveVkCaptcha } from '../lib/vkCaptcha';
import { STANDALONE } from '../lib/standalone';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Icon } from '../components/Icon';
import { tr } from '../i18n/runtime';

/**
 * Signs in to VK with a login and password: VK closed the audio API to third-party clients, so MixOn asks as the
 * official VK app for Android. VK may first want a confirmation code or a "not a robot" check; the form walks through
 * those. The password goes only to VK (through the server or, in the app, the phone) and is not stored.
 */
function VkLogin({ service, onChange }: { service: Service; onChange(s: Service): void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [captchaKey, setCaptchaKey] = useState('');
  const [step, setStep] = useState<Extract<LoginStep, { status: 'code' | 'captcha' }> | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (extra: Record<string, string> = {}) => {
    setBusy(true);
    try {
      let result = await api<LoginStep>(`/services/${service.id}/login`, { body: { username, password, ...extra } });
      // A "not a robot" page: the app shows it and sends back the proof, then VK is asked once more.
      if (result.status === 'captcha' && result.page && canSolveVkCaptcha()) {
        const captchaToken = await solveVkCaptcha(result.page);
        if (!captchaToken) throw new Error('Проверка «я не робот» не пройдена — попробуйте ещё раз');
        result = await api<LoginStep>(`/services/${service.id}/login`, { body: { username, password, ...extra, captchaToken } });
      }
      if (result.status === 'ok') {
        onChange(result.service);
        toast.success(`${tr(service.name)}: аккаунт ${result.service.account?.displayName ?? ''} подключён`);
        return;
      }
      if (result.status === 'code') {
        if (result.wrongCode) toast.error('Неверный код, попробуйте ещё раз');
        setCode('');
        setStep(result);
        return;
      }
      // A picture captcha with no page to open, or no way to open one here.
      setCaptchaKey('');
      setStep(result);
      if (!result.image && !result.page) {
        toast.info('ВКонтакте просит пройти проверку «я не робот». Откройте вход через приложение MixOn на телефоне.');
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step?.status === 'code') return void send({ code: code.trim() });
    if (step?.status === 'captcha' && step.sid) return void send({ captchaSid: step.sid, captchaKey: captchaKey.trim() });
    void send();
  };

  const codeLabel =
    step?.status === 'code'
      ? step.via === 'app'
        ? 'Код из приложения-аутентификатора'
        : step.via === 'call'
          ? 'Последние цифры входящего звонка'
          : `Код из SMS${step.phoneMask ? ` на ${step.phoneMask}` : ''}`
      : '';

  return (
    <form className="stack" onSubmit={submit}>
      <TextField
        label="Телефон или почта ВКонтакте"
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        disabled={busy || step !== null}
      />
      <TextField
        label="Пароль"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        disabled={busy || step !== null}
      />
      {step?.status === 'code' && (
        <TextField label={codeLabel} type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      )}
      {step?.status === 'captcha' && step.image && (
        <>
          <img className="vk-captcha" src={step.image} alt="Капча ВКонтакте" />
          <TextField label="Введите код с картинки" type="text" value={captchaKey} onChange={(e) => setCaptchaKey(e.target.value)} autoFocus />
        </>
      )}
      {step !== null && (
        <button type="button" className="btn btn-text btn-small" onClick={() => setStep(null)} disabled={busy}>
          Начать заново
        </button>
      )}
      <button className="btn btn-filled btn-small" disabled={busy || username.trim().length < 3 || password.length < 1}>
        {busy ? 'Проверяем…' : step?.status === 'code' ? 'Подтвердить код' : step?.status === 'captcha' ? 'Продолжить' : 'Войти'}
      </button>
      <span className="muted small">Пароль не сохраняется: он уходит только во ВКонтакте для получения токена доступа к аудио.</span>
    </form>
  );
}

interface CardKeys {
  /** This service's keys; null for listeners other than the server's owner, who cannot see or change them. */
  list: ServiceKeyInfo[] | null;
  onSaved(list: ServiceKeyInfo[]): void;
}

function ServiceCard({ service, keys, onChange }: { service: Service; keys: CardKeys; onChange(s: Service): void }) {
  const user = useAuth((s) => s.user);
  const guide = keyGuides(location.origin)[service.id];
  const flag = keys.list?.find((k) => k.flag);
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const connectToken = (e: React.FormEvent) => {
    e.preventDefault();
    void run('connect', async () => {
      const updated = await api<Service>(`/services/${service.id}/connect`, { body: { accessToken: token } });
      onChange(updated);
      setToken('');
      toast.success(`${tr(service.name)}: аккаунт ${updated.account?.displayName ?? ''} подключён`);
    });
  };

  // OAuth: the server returns the service's login page; it redirects back to /sync?connected=…
  const connectOAuth = () =>
    run('connect', async () => {
      const { url } = await api<{ url: string }>(`/services/${service.id}/oauth/start`, { method: 'POST' });
      window.location.assign(url);
    });

  const disconnect = () => run('disconnect', async () => onChange(await api<Service>(`/services/${service.id}/connect`, { method: 'DELETE' })));

  const importLibrary = () =>
    run('import', async () => {
      const result = await api<{ playlistId: number; imported: number }>(`/services/${service.id}/import`, { method: 'POST' });
      toast.success(`Импортировано ${result.imported} ${plural(result.imported, ['трек', 'трека', 'треков'])}`);
      navigate(`/playlists/${result.playlistId}`);
    });

  const importFollowings = () =>
    run('followings', async () => {
      const result = await api<{ found: number; subscribed: number }>(`/services/${service.id}/import-followings`, { method: 'POST' });
      toast.success(
        result.subscribed
          ? `Подписались на ${result.subscribed} ${plural(result.subscribed, ['автора', 'авторов', 'авторов'])} — их треки загружаются в фоне`
          : 'Вы уже подписаны на всех своих авторов',
      );
      window.dispatchEvent(new CustomEvent('soundfy:subscriptions'));
    });

  const status = !service.configured ? (
    <span className="pill pill-warn">Не настроен</span>
  ) : service.available ? (
    <span className="pill pill-good">
      <Icon name="check" size={18} /> Доступен
    </span>
  ) : (
    <span className="pill pill-warn">Нужно подключение</span>
  );

  return (
    <div className="service-card">
      <div className="service-card-head">
        <ServiceIcon id={service.id} size={48} />
        <div>
          <h3>{tr(service.name)}</h3>
          <div className="row-gap">
            <span className="pill">{service.fullTracks ? 'Полные треки' : 'Превью 30 сек'}</span>
            {status}
            {service.unofficial && (
              <span className="pill pill-warn">
                <Icon name="warning" size={16} /> Неофициально
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="muted">{tr(service.description)}</p>

      {service.unofficial && (
        <div className="small notice notice-warn">
          <Icon name="warning" size={18} />
          <span>
            Работает без ключей через внутренний API сайта {tr(service.name)}, как его веб-плеер. Сервис не разрешает такое использование и
            может в любой момент перестать отвечать.{keys.list && ' Можно указать свои ключи ниже или выключить этот режим.'}
          </span>
        </div>
      )}

      {!service.configured && !keys.list && (
        <div className="small notice">
          <Icon name="key" size={18} />
          <span>Сервису нужны ключи API — их указывает владелец сервера.</span>
        </div>
      )}

      {flag && <KeyFlag flag={flag} onSaved={keys.onSaved} />}
      {guide && keys.list && <KeyForm guide={guide} keys={keys.list} onSaved={keys.onSaved} optional={service.configured} />}

      {service.configured && service.connectMode && (
        <>
          {service.connected ? (
            <div className="stack">
              <span className="row-gap">
                <Icon name="link" size={18} /> Аккаунт <strong>{service.account?.displayName}</strong>
              </span>
              <div className="row-gap">
                {service.canImportLibrary && (
                  <button className="btn btn-tonal btn-small" onClick={importLibrary} disabled={busy !== null}>
                    <Icon name="download" size={18} className={busy === 'import' ? 'spin' : ''} /> Импортировать {tr(service.libraryLabel) ?? 'библиотеку'}
                  </button>
                )}
                {service.canImportFollowings && (
                  <button className="btn btn-tonal btn-small" onClick={importFollowings} disabled={busy !== null}>
                    <Icon name="group" size={18} className={busy === 'followings' ? 'spin' : ''} /> Подписаться на моих авторов
                  </button>
                )}
                <button className="btn btn-text btn-small" onClick={disconnect} disabled={busy !== null}>
                  <Icon name="logout" size={18} /> Отключить
                </button>
              </div>
            </div>
          ) : !user ? (
            <Link to="/login?next=/sync" className="btn btn-outlined btn-small">
              Войдите, чтобы подключить
            </Link>
          ) : service.connectMode === 'oauth' && STANDALONE ? (
            // The service sends the listener back to a web address after sign-in, which only a server has.
            <span className="small muted">
              Вход через {tr(service.name)} для импорта лайков и подписок работает, когда телефон подключён к серверу MixOn. Поиск
              и прослушивание работают и так.
            </span>
          ) : service.connectMode === 'oauth' ? (
            <button className="btn btn-filled" onClick={connectOAuth} disabled={busy !== null}>
              <Icon name="login" size={18} /> Войти через {tr(service.name)}
            </button>
          ) : service.canLogin ? (
            <VkLogin service={service} onChange={onChange} />
          ) : (
            <form className="stack" onSubmit={connectToken}>
              {service.serverToken && <span className="small muted">Сейчас используется общий токен сервера — можно подключить свой.</span>}
              <TextField
                label="access_token или ссылка с ним"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
              <button className="btn btn-filled btn-small" disabled={busy !== null || token.trim().length < 10}>
                {busy === 'connect' ? 'Проверяем…' : 'Подключить'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

/** Shows the outcome of an OAuth login the service redirected back from (?connected=… or ?error=…). */
function useOAuthResult() {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('error');
    if (!connected && !error) return;
    if (connected) toast.success(`${serviceInfo(connected).label}: аккаунт подключён`);
    if (error) toast.error(error);
    setParams(
      (p) => {
        p.delete('connected');
        p.delete('error');
        return p;
      },
      { replace: true },
    );
  }, [params, setParams]);
}

/** Genius is no music service, so it has a card of its own: just its key (MixOn ships with one). */
function GeniusCard({ keys }: { keys: CardKeys & { list: ServiceKeyInfo[] } }) {
  const guide = keyGuides(location.origin).genius;
  const ready = keys.list.every((k) => k.source);
  return (
    <div className="service-card">
      <div className="service-card-head">
        <ServiceIcon id="genius" size={48} />
        <div>
          <h3>Genius</h3>
          <div className="row-gap">
            <span className="pill">Сведения о песнях</span>
            {ready ? (
              <span className="pill pill-good">
                <Icon name="check" size={18} /> Доступен
              </span>
            ) : (
              <span className="pill pill-warn">Не настроен</span>
            )}
          </div>
        </div>
      </div>
      <p className="muted">{guide.what}</p>
      <KeyForm guide={guide} keys={keys.list} onSaved={keys.onSaved} />
    </div>
  );
}

export function SyncPage() {
  const user = useAuth((s) => s.user);
  const { data: services, loading, error, reload, setData } = useFetch<Service[]>('/services');
  // Keys are the owner's business: other listeners see whether a service works, not its keys.
  const keys = useFetch<ServiceKeyInfo[]>(user?.owner ? '/settings/keys' : null);
  useOAuthResult();

  useEffect(() => {
    if (services && keys.data && location.hash === '#keys') document.getElementById('keys')?.scrollIntoView({ behavior: 'smooth' });
  }, [services, keys.data]);

  const onKeysSaved = (list: ServiceKeyInfo[]) => {
    keys.setData(() => list);
    reload();
  };
  const keysOf = (service: string): CardKeys => ({
    list: keys.data ? keys.data.filter((k) => k.service === service) : null,
    onSaved: onKeysSaved,
  });
  const genius = keysOf('genius');

  return (
    <div className="page">
      <div className="page-header page-header-column">
        <h1>Сервисы</h1>
        <p className="muted">
          Подключите музыкальные сервисы — MixOn ищет в них артистов и треки, играет их и проверяет новые релизы.{' '}
          {user?.owner && (STANDALONE ? 'Ключи API хранятся на телефоне. ' : 'Ключи API видны только вам как владельцу сервера. ')}
          Искать музыку и импортировать плейлисты — на <Link to="/">главной</Link>, подписки на артистов — в{' '}
          <Link to="/library?tab=artists">Медиатеке</Link>.
        </p>
      </div>
      {(loading || keys.loading) && !services && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {keys.error && <ErrorState message={keys.error} onRetry={keys.reload} />}
      {services && (
        <div className="service-grid" id="keys">
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              keys={keysOf(s.id)}
              onChange={(u) => setData((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null)}
            />
          ))}
          {genius.list && genius.list.length > 0 && <GeniusCard keys={{ ...genius, list: genius.list }} />}
        </div>
      )}
      {!user && (
        <div className="notice">
          <Link to="/login?next=/sync">Войдите</Link>, чтобы подключать аккаунты сервисов и подписываться на артистов.
        </div>
      )}
    </div>
  );
}
