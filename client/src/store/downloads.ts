// Tracks saved on this device for listening without internet. The audio file and the track's details (so the
// "Скачанные" list works offline too) are kept in IndexedDB; the player picks a saved copy over the network.
import { create } from 'zustand';
import { ApiError, getToken } from '../api/client';
import type { Track } from '../api/types';
import { plural } from '../lib/format';
import { toast } from './toasts';

const DB_NAME = 'soundfy-offline';
const AUDIO = 'audio';
const TRACKS = 'tracks';

export interface SavedTrack {
  track: Track;
  size: number;
  type: string;
  savedAt: string;
}

/** YouTube's terms allow its videos only in its own player, online. */
export const canDownload = (track: Track) => track.source !== 'youtube';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(AUDIO);
      request.result.createObjectStore(TRACKS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

async function run<T>(stores: string[], mode: IDBTransactionMode, use: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = use(tx);
    tx.oncomplete = () => resolve(request ? request.result : (undefined as T));
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB'));
  });
}

/** The saved audio of a track as a URL the <audio> element can play, or null. */
export async function savedAudioUrl(trackId: number): Promise<string | null> {
  if (!useDownloads.getState().saved[trackId]) return null;
  const blob = await run<Blob | undefined>([AUDIO], 'readonly', (tx) => tx.objectStore(AUDIO).get(trackId)).catch(() => undefined);
  return blob ? URL.createObjectURL(blob) : null;
}

async function fetchAudio(track: Track): Promise<Blob> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/tracks/${track.id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError('Нет соединения с сервером', 0);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(data?.error ?? `Ошибка ${res.status}`, res.status);
  }
  return res.blob();
}

interface DownloadsState {
  /** Saved tracks by id (details only; the audio stays in IndexedDB). */
  saved: Record<number, SavedTrack>;
  /** Tracks waiting for or in the middle of a download. */
  pending: Record<number, true>;
  download(track: Track): Promise<void>;
  downloadAll(tracks: Track[]): void;
  remove(trackId: number): Promise<void>;
  removeAll(): Promise<void>;
}

/** Downloads run one after another, so a long playlist does not flood the service. */
let queue: Promise<unknown> = Promise.resolve();

export const useDownloads = create<DownloadsState>((set, get) => ({
  saved: {},
  pending: {},

  download(track) {
    const { saved, pending } = get();
    if (saved[track.id] || pending[track.id] || !canDownload(track)) return Promise.resolve();
    set({ pending: { ...pending, [track.id]: true } });
    const job = queue.then(async () => {
      try {
        const blob = await fetchAudio(track);
        const entry: SavedTrack = { track, size: blob.size, type: blob.type, savedAt: new Date().toISOString() };
        await run([AUDIO, TRACKS], 'readwrite', (tx) => {
          tx.objectStore(AUDIO).put(blob, track.id);
          tx.objectStore(TRACKS).put(entry, track.id);
        });
        set((s) => ({ saved: { ...s.saved, [track.id]: entry } }));
      } catch (err) {
        toast.error(`«${track.title}» не скачался: ${(err as Error).message}`);
      } finally {
        set((s) => {
          const rest = { ...s.pending };
          delete rest[track.id];
          return { pending: rest };
        });
      }
    });
    queue = job;
    return job;
  },

  downloadAll(tracks) {
    const todo = tracks.filter((t) => canDownload(t) && !get().saved[t.id]);
    if (!todo.length) {
      toast.info('Всё уже скачано');
      return;
    }
    const skipped = tracks.filter((t) => !canDownload(t)).length;
    const what = `${todo.length} ${plural(todo.length, ['трек', 'трека', 'треков'])}`;
    toast.info(`Скачиваем ${what}${skipped ? `, треки YouTube (${skipped}) скачать нельзя` : ''}`);
    for (const t of todo) void get().download(t);
    void queue.then(() => toast.success('Плейлист сохранён на устройстве'));
  },

  async remove(trackId) {
    await run([AUDIO, TRACKS], 'readwrite', (tx) => {
      tx.objectStore(AUDIO).delete(trackId);
      tx.objectStore(TRACKS).delete(trackId);
    });
    set((s) => {
      const rest = { ...s.saved };
      delete rest[trackId];
      return { saved: rest };
    });
  },

  async removeAll() {
    await run([AUDIO, TRACKS], 'readwrite', (tx) => {
      tx.objectStore(AUDIO).clear();
      tx.objectStore(TRACKS).clear();
    });
    set({ saved: {} });
  },
}));

// Load the list of saved tracks once at start.
if (typeof indexedDB !== 'undefined') {
  run<SavedTrack[]>([TRACKS], 'readonly', (tx) => tx.objectStore(TRACKS).getAll())
    .then((list) => useDownloads.setState({ saved: Object.fromEntries(list.map((e) => [e.track.id, e])) }))
    .catch(() => {});
}

/** Saved tracks, newest first. */
export function useSavedTracks(): SavedTrack[] {
  const saved = useDownloads((s) => s.saved);
  return Object.values(saved).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
