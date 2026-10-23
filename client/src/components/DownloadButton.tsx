import type { Track } from '../api/types';
import { canDownload, useDownloads } from '../store/downloads';
import { toast } from '../store/toasts';
import { Icon } from './Icon';

/** Saves a track on the device for listening offline, or removes the saved copy. Not shown for YouTube tracks. */
export function DownloadButton({ track, labels = false }: { track: Track; labels?: boolean }) {
  const saved = useDownloads((s) => Boolean(s.saved[track.id]));
  const pending = useDownloads((s) => Boolean(s.pending[track.id]));
  if (!canDownload(track)) return null;

  const onClick = async () => {
    const { download, remove } = useDownloads.getState();
    if (saved) {
      await remove(track.id);
      toast.info('Удалено с устройства');
      return;
    }
    await download(track);
    if (useDownloads.getState().saved[track.id]) toast.success(`«${track.title}» сохранён — играет и без интернета`);
  };

  const title = pending ? 'Скачиваем…' : saved ? 'Скачан — нажмите, чтобы удалить с устройства' : 'Скачать, чтобы слушать без интернета';
  return (
    <button className={`action-btn ${saved ? 'action-btn-active' : ''}`} onClick={onClick} disabled={pending} title={title} aria-label={title}>
      <Icon name={pending ? 'progress_activity' : saved ? 'download_done' : 'download'} size={18} className={pending ? 'spin' : ''} />
      {labels && <span>{pending ? 'Скачиваем…' : saved ? 'Скачан' : 'Скачать'}</span>}
    </button>
  );
}
