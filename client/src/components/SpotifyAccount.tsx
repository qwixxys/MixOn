import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { ImportResult } from '../api/types';
import { copyText } from '../lib/clipboard';
import { plural } from '../lib/format';
import { beforeLeave, STANDALONE } from '../lib/standalone';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toasts';
import { Icon } from './Icon';
import { resultMessage } from './ImportPlaylist';
import { TextField } from './Material';
import { ServiceIcon } from './ServiceBadge';
import { Loading } from './States';

interface SpotifyStatus {
  connected: boolean;
  displayName: string | null;
  /** The Client ID last signed in with, to fill the field in again. */
  clientId: string | null;
}

interface SpotifyLibrary {
  liked: number;
  playlists: { id: string; name: string; total: number; image: string | null; owner: string | null }[];
}

/** Where Spotify sends the listener back after signing in: the phone app (MainActivity), or this server. */
const redirectUri = () => (STANDALONE ? 'mixon://spotify-callback' : `${location.origin}/api/spotify/callback`);

/** Spotify takes back addresses only on https, on 127.0.0.1 or in an app; not plain http on another address. */
const redirectAccepted = () => STANDALONE || location.protocol === 'https:' || ['127.0.0.1', '[::1]'].includes(location.hostname);

/** The sign-in the phone app came back with, finished once even if the page renders twice. */
let finishing: string | null = null;

const songs = (n: number) => `${n} ${plural(n, ['трек', 'трека', 'треков'])}`;

/**
 * On «Сервисы»: the listener's own Spotify account (server/src/lib/spotifyAccount.ts), for liked songs and private
 * playlists. Signing in goes through a Spotify app the listener registers once, as in Riff.
 */
export function SpotifyCard() {
  const status = useFetch<SpotifyStatus>('/spotify');
  const connected = Boolean(status.data?.connected);
  const library = useFetch<SpotifyLibrary>(connected ? '/spotify/library' : null);
  const [params, setParams] = useSearchParams();
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();
  const setStatus = status.setData;

  // Back from Spotify in the phone app: MainActivity opened this page with what Spotify sent.
  useEffect(() => {
    const state = params.get('spotify_state');
    if (!state || finishing === state) return;
    finishing = state;
    const body = { state, code: params.get('spotify_code'), error: params.get('spotify_error') };
    setParams(
      (p) => {
        for (const key of ['spotify_state', 'spotify_code', 'spotify_error']) p.delete(key);
        return p;
      },
      { replace: true },
    );
    api<SpotifyStatus>('/spotify/callback', { body }).then(
      (s) => {
        setStatus(() => s);
        toast.success('Spotify: аккаунт подключён');
      },
      (err) => toast.error(err),
    );
  }, [params, setParams, setStatus]);

  const id = clientId ?? status.data?.clientId ?? '';

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('login');
    try {
      const { url } = await api<{ url: string }>('/spotify/login', { body: { clientId: id.trim(), redirectUri: redirectUri() } });
      // The sign-in waiting for Spotify is kept in the phone's database; the app may reload before Spotify sends the
      // listener back. In the phone app Spotify opens in the browser and this page stays.
      await beforeLeave();
      window.location.assign(url);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const importList = async (list: string) => {
    setBusy(list);
    try {
      const r = await api<ImportResult>('/spotify/import', { body: { list } });
      toast.success(resultMessage(r));
      navigate(`/playlists/${r.playlistId}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    try {
      const s = await api<SpotifyStatus>('/spotify', { method: 'DELETE' });
      status.setData(() => s);
    } catch (err) {
      toast.error(err);
    }
  };

  const copy = async () => {
    try {
      await copyText(redirectUri());
      toast.success('Адрес скопирован');
    } catch {
      toast.error('Не удалось скопировать — выделите адрес вручную');
    }
  };

  return (
    <div className="service-card">
      <div className="service-card-head">
        <ServiceIcon id="spotify" size={48} />
        <div>
          <h3>Spotify</h3>
          <div className="row-gap">
            <span className="pill">Перенос музыки</span>
            {connected ? (
              <span className="pill pill-good">
                <Icon name="check" size={18} /> Подключён
              </span>
            ) : (
              <span className="pill">Не подключён</span>
            )}
          </div>
        </div>
      </div>
      <p className="muted">
        Любимые треки и закрытые плейлисты из вашего аккаунта Spotify. Сам Spotify играет музыку только в своих приложениях, поэтому
        каждую песню MixOn находит в ваших сервисах. Открытые плейлисты переносятся и без входа — по ссылке на главной.
      </p>

      {status.loading && !status.data && <Loading />}

      {status.data && connected && (
        <div className="stack">
          <span className="row-gap">
            <Icon name="link" size={18} /> Аккаунт <strong>{status.data.displayName}</strong>
          </span>
          {library.loading && !library.data && <Loading />}
          {library.error && <span className="small notice notice-warn">{library.error}</span>}
          {library.data && (
            <ul className="spotify-lists">
              <li>
                <span className="spotify-list-cover spotify-list-liked">
                  <Icon name="favorite" size={20} filled />
                </span>
                <span className="spotify-list-name">
                  <span>Любимые треки</span>
                  <span className="muted small">{songs(library.data.liked)}</span>
                </span>
                <ImportButton list="liked" busy={busy} onClick={importList} />
              </li>
              {library.data.playlists.map((p) => (
                <li key={p.id}>
                  {p.image ? <img className="spotify-list-cover" src={p.image} alt="" loading="lazy" /> : <span className="spotify-list-cover" />}
                  <span className="spotify-list-name">
                    <span>{p.name}</span>
                    <span className="muted small">{songs(p.total)}</span>
                  </span>
                  <ImportButton list={p.id} busy={busy} onClick={importList} />
                </li>
              ))}
            </ul>
          )}
          {busy && busy !== 'login' && (
            <span className="small notice import-progress">
              <Icon name="progress_activity" size={18} className="spin" />
              <span>Ищем каждую песню в ваших сервисах — это может занять несколько минут.</span>
            </span>
          )}
          <div className="row-gap">
            <button className="btn btn-text btn-small" onClick={disconnect} disabled={busy !== null}>
              <Icon name="logout" size={18} /> Отключить
            </button>
          </div>
        </div>
      )}

      {status.data && !connected && (
        <form className="stack" onSubmit={login}>
          <ol className="key-steps">
            <li>
              Откройте{' '}
              <a className="link" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                developer.spotify.com/dashboard
              </a>
              , войдите в свой аккаунт Spotify и нажмите Create app. Название и описание — любые.
            </li>
            <li>
              В Redirect URIs вставьте этот адрес и нажмите Add, в «Which API/SDKs are you planning to use?» отметьте Web API и
              сохраните:
              <span className="spotify-redirect">
                <code>{redirectUri()}</code>
                <button type="button" className="icon-btn" onClick={copy} title="Скопировать адрес">
                  <Icon name="content_copy" size={18} />
                </button>
              </span>
            </li>
            <li>Скопируйте Client ID приложения и вставьте его ниже. Client secret не нужен.</li>
            <li>Если входите не тем аккаунтом, которым создавали приложение, добавьте его в User Management приложения.</li>
          </ol>
          {!redirectAccepted() && (
            <span className="small notice notice-warn">
              <Icon name="warning" size={18} />
              <span>
                Spotify принимает адрес возврата только с https или на 127.0.0.1, поэтому отсюда войти не получится. Войдите в MixOn на
                компьютере, где он запущен, или в приложении на телефоне без сервера.
              </span>
            </span>
          )}
          <TextField label="Client ID" value={id} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
          <div className="row-gap">
            <button className="btn btn-filled" disabled={busy !== null || !/^[0-9a-f]{32}$/i.test(id.trim())}>
              <Icon name="login" size={18} /> Войти через Spotify
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ImportButton({ list, busy, onClick }: { list: string; busy: string | null; onClick(list: string): void }) {
  return (
    <button className="btn btn-tonal btn-small" onClick={() => onClick(list)} disabled={busy !== null}>
      <Icon name={busy === list ? 'progress_activity' : 'download'} size={18} className={busy === list ? 'spin' : ''} />
      {busy === list ? 'Импортируем…' : 'Импортировать'}
    </button>
  );
}
