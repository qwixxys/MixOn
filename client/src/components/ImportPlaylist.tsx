import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import type { ImportResult, Service } from '../api/types';
import { plural } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toasts';
import { Icon } from './Icon';
import { TextField } from './Material';
import { Modal } from './Modal';

const EXAMPLES: Record<string, string> = {
  deezer: 'deezer.com/playlist/… или /album/…',
  soundcloud: 'soundcloud.com/автор/sets/…',
};

/**
 * Copies a public playlist or album from another service by its link: no keys and no login on that service.
 * The result is a private playlist; importing the same link again adds what is new.
 */
export function ImportLinkForm({ services, onDone }: { services: Service[]; onDone?(): void }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const sources = services.filter((s) => s.importsLinks);
  const previews = sources.filter((s) => !s.fullTracks).map((s) => s.name);
  if (!sources.length) return null;

  const paste = async () => {
    try {
      setUrl((await navigator.clipboard.readText()).trim());
    } catch {
      toast.error('Браузер не дал прочитать буфер обмена — вставьте ссылку вручную');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const r = await api<ImportResult>('/import', { body: { url: url.trim() } });
      const skipped = r.total - r.imported;
      toast.success(
        `«${r.title}»: ${r.imported} ${plural(r.imported, ['трек', 'трека', 'треков'])}` +
          (skipped > 0 ? `, ${skipped} недоступно для прослушивания` : ''),
      );
      onDone?.();
      navigate(`/playlists/${r.playlistId}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
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
          supportingText={sources.map((s) => EXAMPLES[s.id] ?? s.name).join(' · ')}
        />
        {typeof navigator.clipboard?.readText === 'function' && (
          <button type="button" className="icon-btn" onClick={paste} title="Вставить из буфера обмена" disabled={busy}>
            <Icon name="content_paste" />
          </button>
        )}
        <button className="btn btn-filled" disabled={busy || !url.trim()}>
          <Icon name={busy ? 'progress_activity' : 'download'} size={18} className={busy ? 'spin' : ''} />
          {busy ? 'Импортируем…' : 'Импортировать'}
        </button>
      </div>
      <span className="muted small">
        Работает с открытыми плейлистами {sources.map((s) => s.name).join(' и ')}, ключи и вход в эти сервисы не нужны.
        {previews.length > 0 && ` Треки ${previews.join(' и ')} доступны как 30-секундные превью.`}
      </span>
    </form>
  );
}

export function ImportPlaylistDialog({ onClose, onImported }: { onClose(): void; onImported?(): void }) {
  const services = useFetch<Service[]>('/services');
  return (
    <Modal title="Импорт по ссылке" onClose={onClose}>
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
