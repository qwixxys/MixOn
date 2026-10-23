import type Hls from 'hls.js';
import { create } from 'zustand';
import { api } from '../api/client';
import type { StreamSource, Track } from '../api/types';
import { serviceInfo } from '../lib/services';
import { savedAudioUrl, useDownloads } from './downloads';
import { usePlayVia } from './playVia';
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

/** Whether `current` is the track with this id, or plays in its place (the same song on another service). */
export function sameTrack(current: Track | null, id: number): boolean {
  return current !== null && (current.id === id || current.standsFor === id);
}

/** Songs already reported missing on the chosen service, so a queue does not repeat it at every play. */
const missingOnChosen = new Set<string>();

/**
 * `track` from the service chosen for listening (store/playVia.ts), when it was found elsewhere and that service has
 * the same song; null to play it where it was found.
 */
async function preferredVersion(track: Track): Promise<Track | null> {
  const via = usePlayVia.getState().via;
  if (!via || track.source === via || track.source === 'local') return null;
  try {
    const version = await api<Track>(`/tracks/${track.id}/version?on=${encodeURIComponent(via)}`);
    if (version.id === track.id) return null;
    // Keep the cover the listener saw if this service has none.
    return { ...version, coverUrl: version.coverUrl ?? track.coverUrl, standsFor: track.standsFor ?? track.id };
  } catch {
    const key = `${via}:${track.id}`;
    if (track.isPreview && !missingOnChosen.has(key)) {
      missingOnChosen.add(key);
      toast.info(`${serviceInfo(via).label}: этой песни нет — играет 30-секундный отрывок из ${serviceInfo(track.source).label}`);
    }
    return null;
  }
}

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
  /** Plays `track`; unless `exact`, from the service chosen for listening when that one has the song too. */
  async function load(track: Track, startAt = 0, exact = false) {
    const seq = ++loadSeq;
    playReported = false;
    destroyHls();
    set({ current: track, loading: true, error: null, currentTime: startAt, duration: track.duration });
    updateMediaSession(track);

    try {
      // A copy saved on the device plays without the network.
      const saved = (t: Track) => (useDownloads.getState().saved[t.id] ? savedAudioUrl(t.id) : Promise.resolve(null));
      let offline = await saved(track);
      if (!offline && !exact) {
        const preferred = await preferredVersion(track);
        if (seq !== loadSeq) return;
        if (preferred) {
          const original = track;
          track = preferred;
          set({ queue: get().queue.map((t) => (t.id === original.id ? preferred : t)), current: preferred, duration: preferred.duration });
          updateMediaSession(preferred);
          offline = await saved(preferred);
        }
      }
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
      if (sameTrack(current, track.id) && startAt === undefined) return get().toggle();
      if (sameTrack(current, track.id) && startAt !== undefined) {
        get().seek(startAt);
        resume();
        return;
      }
      let nextQueue = queue ?? get().queue;
      let index = nextQueue.findIndex((t) => t.id === track.id || t.standsFor === track.id);
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
      const version = { ...track, standsFor: current.standsFor ?? current.id };
      set({ queue: queue.map((t, i) => (i === index && t.id === current.id ? version : t)) });
      // Exactly this version: the listener (or YouTube's closed window) picked it over the chosen service.
      void load(version, startAt, true);
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
  // Several artwork sizes so Android (and the live-activity capsule on One UI, Xiaomi, Vivo…) picks a crisp one.
  const art = track.coverUrl ? new URL(track.coverUrl, location.href).href : null;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? undefined,
    artwork: art ? ['96x96', '192x192', '256x256', '512x512'].map((sizes) => ({ src: art, sizes, type: 'image/jpeg' })) : [],
  });
  syncMediaSessionState();
}

/**
 * Tells the OS whether a track is playing and where it is, so the system media notification — which the live-activity
 * capsule on One UI (Now Bar), Xiaomi, Vivo and others shows — has the right play/pause state and a progress bar.
 */
function syncMediaSessionState() {
  if (!('mediaSession' in navigator)) return;
  const st = usePlayer.getState();
  navigator.mediaSession.playbackState = !st.current ? 'none' : st.playing ? 'playing' : 'paused';
  try {
    if (st.current && Number.isFinite(st.duration) && st.duration > 0 && 'setPositionState' in navigator.mediaSession) {
      navigator.mediaSession.setPositionState({
        duration: st.duration,
        position: Math.min(Math.max(st.currentTime, 0), st.duration),
        playbackRate: 1,
      });
    }
  } catch {
    // Some browsers reject position state mid-change; it will be set again on the next update.
  }
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
  const seekBy = (delta: number) => {
    const st = s();
    st.seek(Math.min(Math.max(st.currentTime + delta, 0), st.duration || st.currentTime + delta));
  };
  try {
    navigator.mediaSession.setActionHandler('seekbackward', (d) => seekBy(-(d.seekOffset ?? 10)));
    navigator.mediaSession.setActionHandler('seekforward', (d) => seekBy(d.seekOffset ?? 10));
  } catch {
    // older WebViews may not support these actions
  }

  // Keep the OS notification's play/pause and progress bar in step with the player (position at most once a second).
  let lastPosition = 0;
  usePlayer.subscribe((st, prev) => {
    if (st.playing !== prev.playing || st.current?.id !== prev.current?.id || st.duration !== prev.duration) {
      syncMediaSessionState();
    } else if (st.currentTime !== prev.currentTime) {
      const now = Date.now();
      if (now - lastPosition >= 1000) {
        lastPosition = now;
        syncMediaSessionState();
      }
    }
  });
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
