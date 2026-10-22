import { Check, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import type { Playlist } from '../api/types';
import { plural } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { usePlaylistPicker } from '../store/playlistPicker';
import { toast } from '../store/toasts';
import { Cover } from './Cover';
import { Switch, TextField } from './Material';
import { Modal } from './Modal';
import { Loading } from './States';

export function PlaylistPicker() {
  const track = usePlaylistPicker((s) => s.track);
  const close = usePlaylistPicker((s) => s.close);
  if (!track) return null;
  return <PickerDialog key={track.id} trackId={track.id} title={track.title} onClose={close} />;
}

function PickerDialog({ trackId, title, onClose }: { trackId: number; title: string; onClose(): void }) {
  const { data, loading } = useFetch<Playlist[]>('/me/playlists');
  const [added, setAdded] = useState<number[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);

  const add = async (playlist: Playlist) => {
    try {
      await api(`/playlists/${playlist.id}/tracks`, { body: { trackId } });
      setAdded((a) => [...a, playlist.id]);
      toast.success(`Добавлено в «${playlist.title}»`);
    } catch (err) {
      toast.error(err);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      const playlist = await api<Playlist>('/playlists', { body: { title: newTitle.trim(), isPublic, trackIds: [trackId] } });
      toast.success(`Плейлист «${playlist.title}» создан`);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Добавить «${title}»`} onClose={onClose}>
      <form className="picker-create" onSubmit={create}>
        <TextField label="Новый плейлист" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={100} />
        <Switch checked={!isPublic} onChange={(v) => setIsPublic(!v)} label="Приватный" />
        <div className="form-actions">
          <button className="btn btn-tonal" disabled={busy || !newTitle.trim()}>
            <Plus size={18} /> Создать и добавить
          </button>
        </div>
      </form>
      {loading && <Loading />}
      <div className="picker-list">
        {data?.map((p) => {
          const done = added.includes(p.id);
          return (
            <div key={p.id} className="picker-item">
              <Cover url={p.coverUrl} seed={`p${p.id}`} size={40} />
              <div className="picker-item-main">
                <span>
                  {!p.isPublic && <Lock size={12} />} {p.title}
                </span>
                <span className="muted small">
                  {p.trackCount + (done ? 1 : 0)} {plural(p.trackCount + (done ? 1 : 0), ['трек', 'трека', 'треков'])}
                </span>
              </div>
              <button className={`btn btn-small ${done ? 'btn-text' : 'btn-outlined'}`} disabled={done} onClick={() => add(p)}>
                {done ? <Check size={18} /> : 'Добавить'}
              </button>
            </div>
          );
        })}
        {data && !data.length && <p className="muted">У вас пока нет плейлистов — создайте первый.</p>}
      </div>
    </Modal>
  );
}
