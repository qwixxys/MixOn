import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { Artist, FoundArtist, Service, SyncResult, SyncSummary } from '../api/types';
import { Avatar } from '../components/Cover';
import { TextField } from '../components/Material';
import { ServiceBadge, ServiceIcon } from '../components/ServiceBadge';
import { ImportLinkForm } from '../components/ImportPlaylist';
import { ServiceKeys } from '../components/ServiceKeys';
import { Empty, ErrorState, Loading } from '../components/States';
import { runSync } from '../components/SyncWidget';
import { Tabs } from '../components/Tabs';
import { plural, timeAgo } from '../lib/format';
import { serviceInfo } from '../lib/services';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Icon } from '../components/Icon';

function VkInstructions() {
  return (
    <details className="instructions">
      <summary>Как получить токен ВКонтакте</summary>
      <ol>
        <li>
          Аудио-методы VK API закрыты для сторонних приложений: они отвечают только на токены официальных клиентов ВКонтакте
          (например, Kate Mobile) с правами <code>audio</code> и <code>offline</code>.
        </li>
        <li>Получите access_token такого клиента для своего аккаунта.</li>
        <li>
          Вставьте в поле ниже сам токен или всю ссылку из адресной строки вида{' '}
          <code>https://oauth.vk.com/blank.html#access_token=…</code> — токен извлечётся автоматически.
        </li>
      </ol>
      <p className="muted small">
        Токен хранится на сервере soundFy и используется только для запросов к ВКонтакте от вашего имени: поиска артистов, проверки
        новых релизов и воспроизведения. Это неофициальный способ доступа, ВКонтакте может его ограничить. Никому не передавайте
        токен.
      </p>
    </details>
  );
}

function ServiceCard({ service, onChange }: { service: Service; onChange(s: Service): void }) {
  const user = useAuth((s) => s.user);
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
      toast.success(`${service.name}: аккаунт ${updated.account?.displayName ?? ''} подключён`);
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
          <h3>{service.name}</h3>
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
      <p className="muted">{service.description}</p>

      {service.unofficial && (
        <div className="small notice notice-warn">
          <Icon name="warning" size={18} />
          <span>
            Работает без ключей через внутренний API сайта {service.name}, как его веб-плеер. Сервис не разрешает такое использование и
            может в любой момент перестать отвечать. Режим включил администратор сервера.
          </span>
        </div>
      )}

      {!service.configured && (
        <div className="small notice">
          <Icon name="key" size={18} />
          {user?.owner ? (
            <span>
              Нужны ключи API: укажите их ниже, в разделе <a href="#keys">«Ключи сервисов»</a>.
            </span>
          ) : (
            <span>Сервису нужны ключи API — их указывает владелец сервера.</span>
          )}
        </div>
      )}

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
                    <Icon name="download" size={18} className={busy === 'import' ? 'spin' : ''} /> Импортировать {service.libraryLabel ?? 'библиотеку'}
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
          ) : service.connectMode === 'oauth' ? (
            <button className="btn btn-filled" onClick={connectOAuth} disabled={busy !== null}>
              <Icon name="login" size={18} /> Войти через {service.name}
            </button>
          ) : (
            <form className="stack" onSubmit={connectToken}>
              {service.serverToken && <span className="small muted">Сейчас используется общий токен сервера — можно подключить свой.</span>}
              {service.id === 'vk' && <VkInstructions />}
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

function ArtistSearch({ services, onSubscribed }: { services: Service[]; onSubscribed(): void }) {
  const user = useAuth((s) => s.user);
  const [params, setParams] = useSearchParams();
  const available = services.filter((s) => s.available);
  const [provider, setProvider] = useState(params.get('provider') ?? available[0]?.id ?? 'deezer');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [results, setResults] = useState<FoundArtist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const search = async (query = q, prov = provider) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setParams(
      (p) => {
        p.set('q', query.trim());
        p.set('provider', prov);
        return p;
      },
      { replace: true },
    );
    try {
      setResults(await api<FoundArtist[]>(`/services/${prov}/artists?q=${encodeURIComponent(query.trim())}`));
    } catch (err) {
      setResults(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params.get('q')) void search(params.get('q')!, provider);
    // Only run for the query the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribe = async (a: FoundArtist) => {
    setPending(a.externalId);
    try {
      const res = await api<{ artist: Artist; sync: SyncResult }>('/subscriptions', {
        body: { provider: a.provider, externalId: a.externalId, name: a.name, imageUrl: a.imageUrl, url: a.url },
      });
      setResults((r) => r?.map((x) => (x.externalId === a.externalId ? { ...x, isSubscribed: true, artistId: res.artist.id } : x)) ?? null);
      if (res.sync.error) toast.error(`Подписка оформлена, но загрузить треки не удалось: ${res.sync.error}`);
      else toast.success(`${a.name}: загружено ${res.sync.fetched} ${plural(res.sync.fetched, ['трек', 'трека', 'треков'])}`);
      onSubscribed();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };

  if (!available.length) return null;
  return (
    <section className="section">
      <h2>Найти артиста</h2>
      <Tabs
        tabs={available.map((s) => ({ id: s.id, label: s.name }))}
        value={provider}
        onChange={(id) => {
          setProvider(id);
          setResults(null);
          if (q.trim()) void search(q, id);
        }}
      />
      <form
        className="search search-large"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя артиста или группы" />
        <button className="btn btn-filled btn-small" disabled={loading || !q.trim()}>
          Найти
        </button>
      </form>
      {loading && <Loading label="Ищем…" />}
      {error && <ErrorState message={error} />}
      {results && !results.length && <Empty title="Никого не нашли">Попробуйте другое написание или другой сервис.</Empty>}
      <div className="artist-results">
        {results?.map((a) => (
          <div key={a.externalId} className="artist-result">
            <Avatar url={a.imageUrl} name={a.name} size={56} />
            <div className="artist-result-main">
              {a.artistId ? <Link to={`/artists/${a.artistId}`}>{a.name}</Link> : <strong>{a.name}</strong>}
              {a.subtitle && <span className="muted small">{a.subtitle}</span>}
            </div>
            {a.url && (
              <a className="icon-btn" href={a.url} target="_blank" rel="noreferrer" title="Открыть в сервисе">
                <Icon name="open_in_new" />
              </a>
            )}
            {user ? (
              <button
                className={`btn btn-small ${a.isSubscribed ? 'btn-outlined' : 'btn-filled'}`}
                disabled={a.isSubscribed || pending !== null}
                onClick={() => subscribe(a)}
              >
                {pending === a.externalId ? 'Загружаем…' : a.isSubscribed ? 'Вы подписаны' : 'Подписаться'}
              </button>
            ) : (
              <Link to="/login?next=/sync" className="btn btn-small btn-filled">
                Подписаться
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function MyArtists() {
  const { data, loading, error, reload, setData } = useFetch<Artist[]>('/subscriptions');
  const [syncing, setSyncing] = useState<number | 'all' | null>(null);

  const syncOne = async (a: Artist) => {
    setSyncing(a.id);
    try {
      const r = await api<SyncResult>(`/artists/${a.id}/sync`, { method: 'POST' });
      toast.success(
        `${a.name}: ${r.newTracks ? `${r.newTracks} ${plural(r.newTracks, ['новый трек', 'новых трека', 'новых треков'])}` : 'новых треков нет'}`,
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setSyncing(null);
      reload();
    }
  };

  const syncAll = async () => {
    setSyncing('all');
    const summary: SyncSummary | null = await runSync();
    setSyncing(null);
    if (summary) reload();
  };

  const unsubscribe = async (a: Artist) => {
    try {
      await api(`/subscriptions/${a.id}`, { method: 'DELETE' });
      setData((d) => d?.filter((x) => x.id !== a.id) ?? null);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Мои артисты</h2>
        {data && data.length > 0 && (
          <button className="btn btn-filled btn-small" onClick={syncAll} disabled={syncing !== null}>
            <Icon name="refresh" size={18} className={syncing === 'all' ? 'spin' : ''} /> Проверить новинки у всех
          </button>
        )}
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && !data.length && (
        <Empty title="Подписок пока нет">Найдите артиста выше — его новые треки будут появляться в вашей ленте и уведомлениях.</Empty>
      )}
      <div className="subscriptions">
        {data?.map((a) => (
          <div key={a.id} className="subscription">
            <Link to={`/artists/${a.id}`}>
              <Avatar url={a.imageUrl} name={a.name} size={48} />
            </Link>
            <div className="subscription-main">
              <div className="row-gap">
                <Link to={`/artists/${a.id}`} className="strong">
                  {a.name}
                </Link>
                <ServiceBadge source={a.provider} />
              </div>
              <span className="muted small">
                {a.trackCount} {plural(a.trackCount, ['трек', 'трека', 'треков'])}
                {a.latestReleaseAt && <> · последний релиз {timeAgo(a.latestReleaseAt)}</>}
                {a.lastSyncedAt ? <> · проверено {timeAgo(a.lastSyncedAt)}</> : <> · ещё не синхронизирован</>}
              </span>
              {a.lastError && (
                <span className="small error-text">
                  <Icon name="error" size={18} /> {a.lastError}
                </span>
              )}
            </div>
            <button className="icon-btn" onClick={() => syncOne(a)} disabled={syncing !== null} title="Проверить новинки">
              <Icon name="refresh" className={syncing === a.id ? 'spin' : ''} />
            </button>
            <button className="icon-btn" onClick={() => unsubscribe(a)} title="Отписаться">
              <Icon name="delete" />
            </button>
          </div>
        ))}
      </div>
    </section>
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

export function SyncPage() {
  const user = useAuth((s) => s.user);
  const { data: services, loading, error, reload, setData } = useFetch<Service[]>('/services');
  const [version, setVersion] = useState(0);
  useOAuthResult();

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener('soundfy:subscriptions', bump);
    return () => window.removeEventListener('soundfy:subscriptions', bump);
  }, []);

  return (
    <div className="page">
      <div className="page-header page-header-column">
        <h1>Сервисы и синхронизация</h1>
        <p className="muted">
          Подпишитесь на артистов в SoundCloud, ВК Музыке, Deezer, Apple Music и Jamendo. soundFy регулярно проверяет их новые треки,
          добавляет в вашу ленту и присылает уведомления.
        </p>
      </div>
      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {services && (
        <>
          <div className="service-grid">
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} onChange={(u) => setData((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null)} />
            ))}
          </div>
          {user?.owner && <ServiceKeys onSaved={reload} />}
          {user && services.some((s) => s.importsLinks) && (
            <section className="section">
              <h2>Импорт плейлиста по ссылке</h2>
              <ImportLinkForm services={services} />
            </section>
          )}
          <ArtistSearch services={services} onSubscribed={() => setVersion((v) => v + 1)} />
        </>
      )}
      {user ? (
        <MyArtists key={version} />
      ) : (
        <div className="notice">
          <Link to="/login?next=/sync">Войдите</Link>, чтобы подписываться на артистов и получать уведомления о новых релизах.
        </div>
      )}
    </div>
  );
}
