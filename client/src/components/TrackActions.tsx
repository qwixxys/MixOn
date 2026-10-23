import { useNavigate } from 'react-router';
import type { Track } from '../api/types';
import { serviceInfo } from '../lib/services';
import { copyText } from '../lib/clipboard';
import { STANDALONE } from '../lib/standalone';
import { useAuth } from '../store/auth';
import { usePlayer } from '../store/player';
import { usePlaylistPicker } from '../store/playlistPicker';
import { toast } from '../store/toasts';
import { DownloadButton } from './DownloadButton';
import { LikeButton } from './LikeButton';
import { Icon } from './Icon';

export async function shareTrack(track: Track) {
  // Pages of the standalone app exist only on this phone, so it shares the track's page on its service.
  const url = STANDALONE ? track.externalUrl : `${location.origin}/tracks/${track.id}`;
  if (!url) {
    toast.info('У этого трека нет ссылки');
    return;
  }
  try {
    await copyText(url);
    toast.success('Ссылка скопирована');
  } catch {
    toast.info(url);
  }
}

export function TrackActions({ track, labels = false }: { track: Track; labels?: boolean }) {
  const user = useAuth((s) => s.user);
  const openPicker = usePlaylistPicker((s) => s.open);
  const enqueue = usePlayer((s) => s.enqueue);
  const navigate = useNavigate();

  return (
    <div className="track-actions">
      <LikeButton track={track} />
      <button
        className="action-btn"
        title="Добавить в плейлист"
        onClick={() => (user ? openPicker(track) : navigate('/login'))}
      >
        <Icon name="playlist_add" size={18} />
        {labels && <span>В плейлист</span>}
      </button>
      <button
        className="action-btn"
        title="Добавить в очередь"
        onClick={() => {
          enqueue(track);
          toast.info('Добавлено в очередь');
        }}
      >
        <Icon name="playlist_play" size={18} />
        {labels && <span>В очередь</span>}
      </button>
      <DownloadButton track={track} labels={labels} />
      <button className="action-btn" title="Скопировать ссылку" onClick={() => shareTrack(track)}>
        <Icon name="link" size={18} />
        {labels && <span>Поделиться</span>}
      </button>
      {track.externalUrl && (
        <a className="action-btn" href={track.externalUrl} target="_blank" rel="noreferrer" title={`Открыть в ${serviceInfo(track.source).label}`}>
          <Icon name="open_in_new" size={18} />
          {labels && <span>{serviceInfo(track.source).label}</span>}
        </a>
      )}
    </div>
  );
}
