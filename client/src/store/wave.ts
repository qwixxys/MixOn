import { create } from 'zustand';
import { api } from '../api/client';
import type { Track } from '../api/types';
import { usePlayVia } from './playVia';
import { toast } from './toasts';
import { usePlayer } from './player';

/**
 * «Моя волна»: an endless queue picked for the listener by the server (server/src/wave/service.ts). The player plays
 * it like any queue; this store starts it and adds the next songs as it runs low.
 */
export type WaveMode = 'mix' | 'favorite' | 'discover' | 'popular';

export const WAVE_MODES: { id: WaveMode; label: string }[] = [
  { id: 'mix', label: 'Микс' },
  { id: 'favorite', label: 'Любимое' },
  { id: 'discover', label: 'Незнакомое' },
  { id: 'popular', label: 'Популярное' },
];

const MODE_KEY = 'soundfy.waveMode';
/** The first batch is small, so the wave starts without waiting for every song's full version. */
const FIRST_BATCH = 5;
const BATCH = 10;
/** The next batch is asked for when this few songs are left in the queue. */
const LOW_WATER = 3;
/** Most queue songs named to the server as already there. */
const EXCLUDE = 300;

interface WaveState {
  mode: WaveMode;
  starting: boolean;
  /** Starts the wave (in `mode`, which is remembered) from its first song. */
  start(mode?: WaveMode): Promise<void>;
  /** «Не нравится»: skips the song and keeps it, and after a second one its artist, out of the wave. */
  dislike(track: Track): Promise<void>;
}

function savedMode(): WaveMode {
  try {
    const mode = localStorage.getItem(MODE_KEY);
    if (WAVE_MODES.some((m) => m.id === mode)) return mode as WaveMode;
  } catch {
    // storage unavailable
  }
  return 'mix';
}

/**
 * The wave's next songs: whole songs only, from the service listened through when it has them. A `background` batch
 * (the queue topping itself up) waits on the services behind anything the listener is waiting for.
 */
function batch(mode: WaveMode, limit: number, exclude: number[] = [], background = false) {
  const params = new URLSearchParams({ mode, limit: String(limit) });
  if (background) params.set('background', '1');
  if (exclude.length) params.set('exclude', exclude.slice(-EXCLUDE).join(','));
  const via = usePlayVia.getState().via;
  if (via) params.set('on', via);
  return api<{ tracks: Track[] }>(`/wave?${params}`).then((r) => r.tracks);
}

export const useWave = create<WaveState>((set, get) => ({
  mode: savedMode(),
  starting: false,

  async start(mode = get().mode) {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // storage unavailable: the mode lasts until reload
    }
    set({ mode, starting: true });
    try {
      const tracks = await batch(mode, FIRST_BATCH);
      if (!tracks.length) {
        toast.info('Волне пока не из чего выбирать: послушайте что-нибудь или подключите сервисы с полными треками');
        return;
      }
      usePlayer.getState().play(tracks[0], tracks, undefined, 'wave');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      set({ starting: false });
    }
  },

  async dislike(track) {
    const id = track.standsFor ?? track.id;
    usePlayer.getState().next();
    try {
      await api('/wave/dislikes', { body: { trackId: id } });
      toast.info('Больше не будем включать этот трек в волну');
    } catch (err) {
      toast.error((err as Error).message);
    }
  },
}));

// The queue runs low: ask for more, never the songs it already has.
let refilling = false;
usePlayer.subscribe((st, prev) => {
  if (st.queueOrigin !== 'wave' || (st.index === prev.index && st.queue === prev.queue)) return;
  if (refilling || st.queue.length - st.index - 1 >= LOW_WATER) return;
  refilling = true;
  const exclude = st.queue.flatMap((t) => (t.standsFor ? [t.id, t.standsFor] : [t.id]));
  batch(useWave.getState().mode, BATCH, exclude, true)
    .then((tracks) => {
      if (usePlayer.getState().queueOrigin === 'wave') usePlayer.getState().appendToQueue(tracks);
    })
    .catch(() => {})
    .finally(() => (refilling = false));
});
