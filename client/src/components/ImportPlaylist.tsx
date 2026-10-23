import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { ImportResult, Service } from '../api/types';
import { plural } from '../lib/format';
import { canPaste, pasteText } from '../lib/clipboard';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toasts';
import { Icon } from './Icon';
import { TextField } from './Material';
import { Modal } from './Modal';
import { ErrorState, Loading } from './States';
import { tr } from '../i18n/runtime';

const EXAMPLES: Record<string, string> = {
  deezer: 'deezer.com/playlist/… или /album/…',
  soundcloud: 'soundcloud.com/автор/sets/…',
  youtube: 'music.youtube.com/playlist?list=…',
};
const SPOTIFY_EXAMPLE = 'open.spotify.com/playlist/… или /album/…';
const isSpotify = (url: string) => /(^|[/.])(open\.spotify\.com|spotify\.link|spoti\.fi)(\/|$)/i.test(url.trim());

function resultMessage(r: ImportResult) {
  const count = `${r.imported} ${plural(r.imported, ['трек', 'трека', 'треков'])}`;
  if (r.missing !== undefined) {
    // Spotify: songs are looked up on the listener's services.
    return (
      `«${r.title}»: найдено ${r.imported} из ${r.fetched}` +
      (r.previews ? `, из них ${r.previews} — 30-секундные отрывки` : '') +
      (r.missing ? `. Не нашлось: ${r.missing}` : '')
    );
  }
  const unavailable = r.fetched - r.imported;
  return (
    `«${r.title}»: ${count}` +
    (unavailable > 0 ? `, ${unavailable} недоступно для прослушивания` : '') +
    (r.total > r.fetched ? `. Взяты первые ${r.fetched} из ${r.total}` : '')
  );
}

/**
 * Copies a public playlist or album from another service by its link: no keys and no login on that service.
 * Spotify plays only in its own apps, so its songs are found on the listener's services instead. The result is a
 * private playlist; importing the same link again adds what is new.
 */
export function ImportLinkForm({ services, onDone }: { services: Service[]; onDone?(): void }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'import' | 'spotify' | null>(null);
  const sources = services.filter((s) => s.importsLinks);
  const previews = sources.filter((s) => !s.fullTracks).map((s) => tr(s.name));
  if (!sources.length) return null;

  const paste = async () => {
    try {
      setUrl((await pasteText()).trim());
    } catch {
      toast.error('Не удалось прочитать буфер обмена — вставьте ссылку вручную');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(isSpotify(url) ? 'spotify' : 'import');
    try {
      const r = await api<ImportResult>('/import', { body: { url: url.trim() } });
      toast.success(resultMessage(r));
      onDone?.();
      navigate(`/playlists/${r.playlistId}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="import-link-row">
        <TextField
          label="Ссылка на плейлист или альбом"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          autoComplete="off"
          maxLength={2000}
          supportingText={[SPOTIFY_EXAMPLE, ...sources.map((s) => EXAMPLES[s.id] ?? tr(s.name))].join(' · ')}
        />
        {canPaste() && (
          <button type="button" className="icon-btn" onClick={paste} title="Вставить из буфера обмена" disabled={busy !== null}>
            <Icon name="content_paste" />
          </button>
        )}
        <button className="btn btn-filled" disabled={busy !== null || !url.trim()}>
          <Icon name={busy ? 'progress_activity' : 'download'} size={18} className={busy ? 'spin' : ''} />
          {busy ? 'Импортируем…' : 'Импортировать'}
        </button>
      </div>
      {busy === 'spotify' ? (
        <span className="small notice import-progress">
          <Icon name="progress_activity" size={18} className="spin" />
          <span>Ищем каждую песню плейлиста в ваших сервисах — это может занять минуту-другую.</span>
        </span>
      ) : (
        <span className="muted small">
          Работает с открытыми плейлистами Spotify, {sources.map((s) => tr(s.name)).join(', ')}, входить в эти сервисы не нужно. Песни
          из Spotify MixOn находит в подключённых сервисах: сам Spotify играет музыку только в своих приложениях.
          {previews.length > 0 && ` Треки ${previews.join(' и ')} доступны как 30-секундные отрывки.`}
        </span>
      )}
    </form>
  );
}

export function ImportPlaylistDialog({ onClose, onImported }: { onClose(): void; onImported?(): void }) {
  const services = useFetch<Service[]>('/services');
  return (
    <Modal title="Импорт по ссылке" onClose={onClose}>
      {services.loading && <Loading />}
      {services.error && <ErrorState message={services.error} onRetry={services.reload} />}
      {services.data && (
        <ImportLinkForm
          services={services.data}
          onDone={() => {
            onImported?.();
            onClose();
          }}
        />
      )}
      {services.data && !services.data.some((s) => s.importsLinks) && (
        <p className="muted">Импорт по ссылке сейчас недоступен: на сервере не настроен ни один подходящий сервис.</p>
      )}
    </Modal>
  );
}
