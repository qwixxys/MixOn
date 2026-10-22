import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { Artist, SyncSummary } from '../api/types';
import { plural, timeAgo } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toasts';
import { Avatar } from './Cover';
import { Icon } from './Icon';

export function announceSync(summary: SyncSummary) {
  window.dispatchEvent(new CustomEvent('soundfy:synced', { detail: summary }));
  if (summary.newTracks) {
    toast.success(`Найдено ${summary.newTracks} ${plural(summary.newTracks, ['новый трек', 'новых трека', 'новых треков'])}`);
  } else if (!summary.errors.length) {
    toast.info('Новых треков пока нет');
  }
  for (const e of summary.errors.slice(0, 3)) toast.error(`${e.name}: ${e.error}`);
}

export async function runSync(): Promise<SyncSummary | null> {
  try {
    const summary = await api<SyncSummary>('/sync', { method: 'POST' });
    announceSync(summary);
    return summary;
  } catch (err) {
    toast.error(err);
    return null;
  }
}

/** Sidebar card summarising the user's subscriptions with a "sync now" button. */
export function SyncWidget({ onSynced }: { onSynced?: () => void }) {
  const { data: artists, reload } = useFetch<Artist[]>('/subscriptions');
  const [busy, setBusy] = useState(false);
  const lastSync = artists?.reduce<string | null>((max, a) => (a.lastSyncedAt && (!max || a.lastSyncedAt > max) ? a.lastSyncedAt : max), null);

  const sync = async () => {
    setBusy(true);
    const result = await runSync();
    setBusy(false);
    if (result) {
      reload();
      onSynced?.();
    }
  };

  return (
    <section className="side-card">
      <div className="side-card-header">
        <h3>Синхронизация</h3>
        <Link to="/sync" className="small">
          Все сервисы
        </Link>
      </div>
      {artists && artists.length > 0 ? (
        <>
          <p className="muted small">
            Вы следите за {artists.length} {plural(artists.length, ['артистом', 'артистами', 'артистами'])}
            {lastSync && <> · обновлено {timeAgo(lastSync)}</>}
          </p>
          <div className="avatar-stack">
            {artists.slice(0, 8).map((a) => (
              <Link key={a.id} to={`/artists/${a.id}`} title={a.name}>
                <Avatar url={a.imageUrl} name={a.name} size={34} />
              </Link>
            ))}
          </div>
          <button className="btn btn-outlined btn-block" onClick={sync} disabled={busy}>
            <Icon name="refresh" size={18} className={busy ? 'spin' : ''} /> {busy ? 'Проверяем…' : 'Проверить новинки'}
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            Подпишитесь на артистов в SoundCloud, ВК Музыке, Deezer, Apple Music или Jamendo — их новые треки будут появляться в вашей
            ленте.
          </p>
          <Link to="/sync" className="btn btn-filled btn-block">
            Подключить сервисы
          </Link>
        </>
      )}
    </section>
  );
}
