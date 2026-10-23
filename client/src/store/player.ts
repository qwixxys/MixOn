import type Hls from 'hls.js';
import { create } from 'zustand';
import { api } from '../api/client';
import type { StreamSource, Track } from '../api/types';
import { serviceInfo } from '../lib/services';
import { savedAudioUrl, useDownloads } from './downloads';
import { toast } from './toasts';
import {
  videoIdOf,
  youtubeIsActive,
  youtubeLoad,
  youtubePause,
  youtubePlay,
  youtubeSeek,
  youtubeStop,
  youtubeToggle,
  youtubeVolume,
  type YouTubeEvents,
} from './youtube';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;

  /** Plays `track` (toggling if it is already current). `queue` becomes the play queue. */
  play(track: Track, queue?: Track[], startAt?: number): void;
  toggle(): void;
  next(auto?: boolean): void;
  prev(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  enqueue(track: Track): void;
  playNext(track: Track): void;
  removeFromQueue(index: number): void;
  /** Puts another version of the current song (the same song from another service) in its place, from `startAt`. */
  swapCurrent(track: Track, startAt: number): void;
}

const PLAY_REPORT_AFTER_SECONDS = 5;

const audio = new Audio();
audio.preload = 'auto';
let hls: Hls | null = null;
let loadSeq = 0;
let playReported = false;
/** Blob URL of the saved copy being played, released when another track starts. */
let savedUrl: string | null = null;

function releaseSavedUrl() {
  if (savedUrl) URL.revokeObjectURL(savedUrl);
  savedUrl = null;
}

function readPrefs() {
  try {
    const raw = localStorage.getItem('soundfy.player');
    if (raw) return JSON.parse(raw) as { volume?: number; muted?: boolean; shuffle?: boolean; repeat?: RepeatMode };
  } catch {
    // ignore unavailable storage / bad JSON
  }
  return {};
}

function savePrefs(state: Pick<PlayerState, 'volume' | 'muted' | 'shuffle' | 'repeat'>) {
  try {
    localStorage.setItem(
      'soundfy.player',
      JSON.stringify({ volume: state.volume, muted: state.muted, shuffle: state.shuffle, repeat: state.repeat }),
    );
  } catch {
    // ignore
  }
}

const prefs = readPrefs();
audio.volume = prefs.volume ?? 0.8;
audio.muted = prefs.muted ?? false;

function destroyHls() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

/** Silences the <audio> element while YouTube's player has the track. */
function stopAudio() {
  destroyHls();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

function resume() {
  if (youtubeIsActive()) youtubePlay();
  else if (audio.paused) void audio.play().catch(() => {});
}

function pause() {
  if (youtubeIsActive()) youtubePause();
  else audio.pause();
}

/** Counts a play once the listener has heard a few seconds of the track. */
function reportProgress(current: number, duration: number) {
  const track = usePlayer.getState().current;
  if (track && !playReported && current >= Math.min(PLAY_REPORT_AFTER_SECONDS, (duration || 10) / 2)) {
    playReported = true;
    api(`/tracks/${track.id}/play`, { method: 'POST' }).catch(() => {});
  }
}

export const usePlayer = create<PlayerState>((set, get) => {
  async function load(track: Track, startAt = 0) {
    const seq = ++loadSeq;
    playReported = false;
    destroyHls();
    set({ current: track, loading: true, error: null, currentTime: startAt, duration: track.duration });
    updateMediaSession(track);

    try {
      // A copy saved on the device plays without the network.
      const offline = useDownloads.getState().saved[track.id] ? await savedAudioUrl(track.id) : null;
      // Local uploads have a predictable URL; setting it synchronously keeps Safari's autoplay rules happy.
      const source: StreamSource = offline
        ? { kind: 'direct', url: offline }
        : track.source === 'local'
          ? { kind: 'direct', url: `/api/tracks/${track.id}/stream` }
          : await api<StreamSource>(`/tracks/${track.id}/source`);
      if (seq !== loadSeq) {
        if (offline) URL.revokeObjectURL(offline);
        return;
      }
      releaseSavedUrl();
      savedUrl = offline;

      if (source.kind === 'youtube') {
        const videoId = videoIdOf(source.url);
        if (!videoId) throw new Error('Не удалось открыть видео YouTube');
        stopAudio();
        await youtubeLoad(videoId, startAt, audio.volume, audio.muted, youtubeEvents);
        return;
      }
      youtubeStop();
      if (source.kind === 'hls' && !audio.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: HlsLib } = await import('hls.js/light');
        if (seq !== loadSeq) return;
        if (!HlsLib.isSupported()) throw new Error('Браузер не поддерживает HLS-потоки');
        hls = new HlsLib();
        hls.loadSource(source.url);
        hls.attachMedia(audio);
      } else {
        audio.src = source.url;
      }
      if (startAt > 0) {
        audio.addEventListener('loadedmetadata', () => (audio.currentTime = startAt), { once: true });
      }
      await audio.play();
    } catch (err) {
      if (seq !== loadSeq || (err as Error).name === 'AbortError') return;
      const message =
        (err as Error).name === 'NotAllowedError'
          ? 'Браузер заблокировал автовоспроизведение — нажмите ▶'
          : (err as Error).message || 'Не удалось воспроизвести трек';
      set({ error: message, loading: false, playing: false });
    }
  }

  return {
    queue: [],
    index: -1,
    current: null,
    playing: false,
    loading: false,
    error: null,
    currentTime: 0,
    duration: 0,
    volume: audio.volume,
    muted: audio.muted,
    shuffle: prefs.shuffle ?? false,
    repeat: prefs.repeat ?? 'off',

    play(track, queue, startAt) {
      const { current } = get();
      if (current?.id === track.id && startAt === undefined) return get().toggle();
      if (current?.id === track.id && startAt !== undefined) {
        get().seek(startAt);
        resume();
        return;
      }
      let nextQueue = queue ?? get().queue;
      let index = nextQueue.findIndex((t) => t.id === track.id);
      if (index === -1) {
        nextQueue = queue ? [track, ...queue] : [track];
        index = 0;
      }
      set({ queue: nextQueue, index });
      void load(track, startAt ?? 0);
    },

    toggle() {
      const { current, error } = get();
      if (!current) {
        const first = get().queue[0];
        if (first) get().play(first);
        return;
      }
      if (error) return void load(current, get().currentTime);
      if (youtubeIsActive()) return youtubeToggle();
      if (!audio.src) return void load(current, get().currentTime);
      if (audio.paused) void audio.play().catch(() => {});
      else audio.pause();
    },

    next(auto = false) {
      const { queue, index, shuffle, repeat } = get();
      if (!queue.length) return;
      let nextIndex: number;
      if (shuffle && queue.length > 1) {
        do nextIndex = Math.floor(Math.random() * queue.length);
        while (nextIndex === index);
      } else {
        nextIndex = index + 1;
        if (nextIndex >= queue.length) {
          if (repeat === 'all' || !auto) nextIndex = 0;
          else {
            set({ playing: false });
            return;
          }
        }
      }
      set({ index: nextIndex });
      void load(queue[nextIndex]);
    },

    prev() {
      const { queue, index } = get();
      if (get().currentTime > 3 || index <= 0) return get().seek(0);
      set({ index: index - 1 });
      void load(queue[index - 1]);
    },

    seek(seconds) {
      const youtube = youtubeIsActive();
      const max = !youtube && Number.isFinite(audio.duration) ? audio.duration : get().duration;
      const t = Math.max(0, Math.min(seconds, max || seconds));
      if (youtube) youtubeSeek(t);
      else audio.currentTime = t;
      set({ currentTime: t });
    },

    setVolume(volume) {
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.muted = false;
      youtubeVolume(audio.volume, false);
      set({ volume: audio.volume, muted: false });
      savePrefs(get());
    },

    toggleMute() {
      audio.muted = !audio.muted;
      youtubeVolume(audio.volume, audio.muted);
      set({ muted: audio.muted });
      savePrefs(get());
    },

    toggleShuffle() {
      set({ shuffle: !get().shuffle });
      savePrefs(get());
    },

    cycleRepeat() {
      const order: RepeatMode[] = ['off', 'all', 'one'];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
      savePrefs(get());
    },

    enqueue(track) {
      const { queue, current } = get();
      if (!current) return get().play(track, [track]);
      if (!queue.some((t) => t.id === track.id)) set({ queue: [...queue, track] });
    },

    playNext(track) {
      const { queue, index, current } = get();
      if (!current) return get().play(track, [track]);
      const rest = queue.filter((t) => t.id !== track.id);
      const at = rest.findIndex((t) => t.id === current.id);
      rest.splice(at + 1, 0, track);
      set({ queue: rest, index: at === -1 ? index : at });
    },

    swapCurrent(track, startAt) {
      const { queue, index, current } = get();
      if (!current) return;
      set({ queue: queue.map((t, i) => (i === index && t.id === current.id ? track : t)) });
      void load(track, startAt);
    },

    removeFromQueue(i) {
      const { queue, index } = get();
      if (i === index) return;
      set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
    },
  };
});

// ---------- wire the <audio> element to the store ----------

audio.addEventListener('play', () => usePlayer.setState({ playing: true, error: null }));
audio.addEventListener('pause', () => usePlayer.setState({ playing: false }));
audio.addEventListener('waiting', () => usePlayer.setState({ loading: true }));
audio.addEventListener('playing', () => usePlayer.setState({ loading: false }));
audio.addEventListener('canplay', () => usePlayer.setState({ loading: false }));
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) usePlayer.setState({ duration: audio.duration });
});
audio.addEventListener('timeupdate', () => {
  usePlayer.setState({ currentTime: audio.currentTime });
  reportProgress(audio.currentTime, audio.duration);
});
audio.addEventListener('ended', () => {
  const { repeat, next } = usePlayer.getState();
  if (repeat === 'one') {
    audio.currentTime = 0;
    void audio.play();
  } else {
    next(true);
  }
});
audio.addEventListener('error', () => {
  if (!audio.src || hls) return;
  usePlayer.setState({ error: 'Не удалось загрузить аудио', loading: false, playing: false });
});

// ---------- wire YouTube's player to the store ----------

/**
 * The listener closed YouTube's player. YouTube allows its videos only in a visible player, so the song carries on
 * from the same moment in a version from a service that plays plain audio; without one it stays paused.
 */
async function continueWithoutVideo() {
  const { current, currentTime } = usePlayer.getState();
  if (!current) return;
  usePlayer.setState({ loading: true });
  try {
    const version = await api<Track>(`/tracks/${current.id}/audio-version`);
    if (usePlayer.getState().current?.id !== current.id) return; // the listener moved on meanwhile
    usePlayer.getState().swapCurrent(version, currentTime);
    toast.info(`Продолжаем без видео: ${serviceInfo(version.source).label}`);
  } catch {
    usePlayer.setState({ loading: false });
    toast.info('YouTube не разрешает слушать со скрытым видео, а в других сервисах этой песни нет. Трек на паузе — ▶ вернёт окно.');
  }
}

const youtubeEvents: YouTubeEvents = {
  play: () => usePlayer.setState({ playing: true, loading: false, error: null }),
  pause: () => usePlayer.setState({ playing: false, loading: false }),
  buffering: () => usePlayer.setState({ loading: true }),
  ended: () => {
    const { repeat, next } = usePlayer.getState();
    if (repeat === 'one') {
      youtubeSeek(0);
      youtubePlay();
    } else {
      next(true);
    }
  },
  time: (current, duration) => {
    usePlayer.setState(duration > 0 ? { currentTime: current, duration } : { currentTime: current });
    reportProgress(current, duration);
  },
  error: (message) => usePlayer.setState({ error: message, loading: false, playing: false }),
  closed: () => void continueWithoutVideo(),
};

// ---------- OS media controls ----------

function updateMediaSession(track: Track) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? undefined,
    artwork: track.coverUrl ? [{ src: new URL(track.coverUrl, location.href).href, sizes: '500x500' }] : [],
  });
}

if ('mediaSession' in navigator) {
  const s = () => usePlayer.getState();
  navigator.mediaSession.setActionHandler('play', () => {
    if (!s().playing) s().toggle();
  });
  navigator.mediaSession.setActionHandler('pause', pause);
  navigator.mediaSession.setActionHandler('previoustrack', () => s().prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => s().next());
  navigator.mediaSession.setActionHandler('seekto', (d) => d.seekTime !== undefined && s().seek(d.seekTime));
}

/** Playback progress (0..1) of `trackId`, or 0 if another track is playing. */
export function useTrackProgress(trackId: number): number {
  return usePlayer((s) => (s.current?.id === trackId && s.duration ? s.currentTime / s.duration : 0));
}

export function useIsCurrent(trackId: number) {
  return usePlayer((s) => s.current?.id === trackId);
}

export function useIsPlaying(trackId: number) {
  return usePlayer((s) => s.current?.id === trackId && s.playing);
}
