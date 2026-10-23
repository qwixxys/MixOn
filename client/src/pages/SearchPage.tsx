import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { Artist, FoundArtist, SearchResults, Service, SyncResult, Track } from '../api/types';
import { Avatar } from '../components/Cover';
import { Icon } from '../components/Icon';
import { PlaylistGrid } from '../components/PlaylistTile';
import { ServiceBadge } from '../components/ServiceBadge';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackRow } from '../components/TrackRow';
import { formatCount, plural } from '../lib/format';
import { openFoundArtist } from '../lib/openArtist';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { tr } from '../i18n/runtime';

interface ServiceHits {
  artists: FoundArtist[];
  tracks: Track[];
}
type ServiceState = { status: 'loading' } | { status: 'done'; hits: ServiceHits } | { status: 'error'; message: string };

/** Asks every service the listener can use, all at once; each answer shows up as soon as it arrives. */
function useServiceSearch(q: string, services: Service[]) {
  const [state, setState] = useState<Record<string, ServiceState>>({});
  const ids = services.map((s) => s.id).join(',');
  useEffect(() => {
    if (!q || !ids) {
      setState({});
      return;
    }
    const controller = new AbortController();
    const list = ids.split(',');
    setState(Object.fromEntries(list.map((id) => [id, { status: 'loading' }])));
    for (const id of list) {
      api<ServiceHits>(`/services/${id}/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((hits) => setState((s) => ({ ...s, [id]: { status: 'done', hits } })))
        .catch((err: Error) => {
          if (err.name !== 'AbortError') setState((s) => ({ ...s, [id]: { status: 'error', message: err.message } }));
        });
    }
    return () => controller.abort();
  }, [q, ids]);
  return [state, setState] as const;
}

/** Takes the first of each list, then the second of each…, so every service's best matches come near the top. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

function FoundArtistCard({ artist, onSubscribed }: { artist: FoundArtist; onSubscribed(a: FoundArtist): void }) {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);

  const open = async () => {
    if (!user && !artist.artistId) return navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    setOpening(true);
    try {
      navigate(`/artists/${await openFoundArtist(artist)}`);
    } catch (err) {
      toast.error(err);
      setOpening(false);
    }
  };

  const subscribe = async () => {
    setBusy(true);
    try {
      const res = await api<{ artist: Artist; sync: SyncResult }>('/subscriptions', {
        body: { provider: artist.provider, externalId: artist.externalId, name: artist.name, imageUrl: artist.imageUrl, url: artist.url },
      });
      onSubscribed({ ...artist, isSubscribed: true, artistId: res.artist.id });
      window.dispatchEvent(new CustomEvent('soundfy:subscriptions'));
      if (res.sync.error) toast.error(`Подписка оформлена, но загрузить треки не удалось: ${res.sync.error}`);
      else toast.success(`${artist.name}: ${res.sync.fetched} ${plural(res.sync.fetched, ['трек', 'трека', 'треков'])} — новые релизы будут в ленте`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="found-artist">
      <button type="button" className="found-artist-open" onClick={open} disabled={opening} title={`Открыть страницу артиста: ${artist.name}`}>
        <Avatar url={artist.imageUrl} name={artist.name} size={72} />
        <span className="found-artist-name">{artist.name}</span>
      </button>
      <ServiceBadge source={artist.provider} />
      {opening ? (
        <span className="muted small found-artist-sub">Загружаем треки…</span>
      ) : (
        artist.subtitle && <span className="muted small found-artist-sub">{tr(artist.subtitle)}</span>
      )}
      {user ? (
        <button
          className={`btn btn-small ${artist.isSubscribed ? 'btn-outlined' : 'btn-filled'}`}
          disabled={artist.isSubscribed || busy}
          onClick={subscribe}
        >
          {busy ? 'Загружаем…' : artist.isSubscribed ? 'Вы подписаны' : 'Подписаться'}
        </button>
      ) : (
        <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} className="btn btn-small btn-filled">
          Подписаться
        </Link>
      )}
    </div>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const local = useFetch<SearchResults>(q ? `/search?q=${encodeURIComponent(q)}` : null);
  const services = useFetch<Service[]>('/services');
  const order = useMemo(
    // Services with full tracks first, so their results lead the merged list.
    () => [...(services.data ?? [])].sort((a, b) => Number(b.fullTracks) - Number(a.fullTracks)),
    [services.data],
  );
  const usable = useMemo(() => order.filter((s) => s.available), [order]);
  const [found, setFound] = useServiceSearch(q, usable);
  const [only, setOnly] = useState<string | null>(null);
  useEffect(() => setOnly(null), [q]);

  const done = usable.flatMap((s) => {
    const st = found[s.id];
    return st?.status === 'done' && (!only || only === s.id) ? [{ id: s.id, hits: st.hits }] : [];
  });
  const artists = interleave(done.map((d) => d.hits.artists));
  const tracks = interleave(done.map((d) => d.hits.tracks));
  const foundIds = new Set(tracks.map((t) => t.id));
  const known = local.data?.tracks.filter((t) => !foundIds.has(t.id)) ?? [];
  const searching = usable.some((s) => found[s.id]?.status === 'loading');
  const errors = usable.flatMap((s) => {
    const st = found[s.id];
    return st?.status === 'error' ? [`${tr(s.name)}: ${st.message}`] : [];
  });
  const missing = order.filter((s) => !s.available);
  const nothing =
    !searching &&
    !local.loading &&
    !artists.length &&
    !tracks.length &&
    !known.length &&
    !local.data?.users.length &&
    !local.data?.playlists.length &&
    !local.data?.artists.length;

  const markSubscribed = (a: FoundArtist) =>
    setFound((s) => {
      const st = s[a.provider];
      if (st?.status !== 'done') return s;
      const artistsNow = st.hits.artists.map((x) => (x.externalId === a.externalId ? a : x));
      return { ...s, [a.provider]: { status: 'done', hits: { ...st.hits, artists: artistsNow } } };
    });

  if (!q) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Поиск</h1>
        </div>
        <Empty title="Что ищем?">Введите имя артиста или название трека — MixOn поищет во всех подключённых сервисах.</Empty>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Результаты по запросу «{q}»</h1>
      </div>

      {usable.length > 0 && (
        <div className="chips chips-scroll search-services" role="group" aria-label="Сервисы">
          <button className={`chip ${!only ? 'chip-selected' : ''}`} aria-pressed={!only} onClick={() => setOnly(null)}>
            {!only && <Icon name="check" size={18} />}
            Все сервисы
          </button>
          {usable.map((s) => {
            const st = found[s.id];
            const count = st?.status === 'done' ? st.hits.artists.length + st.hits.tracks.length : null;
            return (
              <button
                key={s.id}
                className={`chip ${only === s.id ? 'chip-selected' : ''}`}
                aria-pressed={only === s.id}
                onClick={() => setOnly(only === s.id ? null : s.id)}
                title={st?.status === 'error' ? st.message : undefined}
              >
                {st?.status === 'loading' ? (
                  <Icon name="progress_activity" size={18} className="spin" />
                ) : st?.status === 'error' ? (
                  <Icon name="warning" size={18} />
                ) : (
                  only === s.id && <Icon name="check" size={18} />
                )}
                {tr(s.name)}
                {count !== null && <span className="chip-count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
      {errors.length > 0 && (
        <p className="muted small search-errors">
          {errors.map((e) => (
            <span key={e}>{e}</span>
          ))}
        </p>
      )}
      {missing.length > 0 && (
        <p className="muted small">
          Ещё можно искать в {missing.map((s) => tr(s.name)).join(', ')} — <Link to="/sync">подключите их в «Сервисах»</Link>.
        </p>
      )}

      {artists.length > 0 && (
        <section className="section">
          <h2>Артисты</h2>
          <div className="found-artists">
            {artists.map((a) => (
              <FoundArtistCard key={`${a.provider}:${a.externalId}`} artist={a} onSubscribed={markSubscribed} />
            ))}
          </div>
        </section>
      )}

      {tracks.length > 0 && (
        <section className="section">
          <h2>Треки</h2>
          <div className="chart">
            {tracks.map((t) => (
              <TrackRow key={t.id} track={t} queue={tracks} />
            ))}
          </div>
        </section>
      )}

      {searching && <Loading label="Ищем в сервисах…" />}
      {local.error && <ErrorState message={local.error} onRetry={local.reload} />}

      {!only && local.data && local.data.artists.length > 0 && (
        <section className="section">
          <h2>Артисты в MixOn</h2>
          <div className="people">
            {local.data.artists.map((a) => (
              <Link key={a.id} to={`/artists/${a.id}`} className="person">
                <Avatar url={a.imageUrl} name={a.name} size={96} />
                <span className="person-name">{a.name}</span>
                <ServiceBadge source={a.provider} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {!only && known.length > 0 && (
        <section className="section">
          <h2>Уже в MixOn</h2>
          <div className="chart">
            {known.map((t) => (
              <TrackRow key={t.id} track={t} queue={known} />
            ))}
          </div>
        </section>
      )}
      {!only && local.data && local.data.users.length > 0 && (
        <section className="section">
          <h2>Люди</h2>
          <div className="people">
            {local.data.users.map((u) => (
              <Link key={u.id} to={`/users/${u.username}`} className="person">
                <Avatar url={u.avatarUrl} name={u.displayName} size={96} />
                <span className="person-name">{u.displayName}</span>
                <span className="muted small">
                  {formatCount(u.followers)} {plural(u.followers, ['подписчик', 'подписчика', 'подписчиков'])}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {!only && local.data && local.data.playlists.length > 0 && (
        <section className="section">
          <h2>Плейлисты</h2>
          <PlaylistGrid playlists={local.data.playlists} />
        </section>
      )}
      {nothing && <Empty title="Ничего не найдено">Попробуйте другое написание или другой запрос.</Empty>}
    </div>
  );
}
