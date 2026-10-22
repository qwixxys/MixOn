// YouTube tracks play in YouTube's own embedded player (the IFrame Player API): YouTube's terms allow no other way to
// play its videos, and they ask for the player to stay visible and at least 200×200 px. So while a YouTube track is
// current, the player sits in a small window above the player bar and the app drives it like the <audio> element.

/** YT.PlayerState values. */
const State = { Unstarted: -1, Ended: 0, Playing: 1, Paused: 2, Buffering: 3, Cued: 5 } as const;

interface YTPlayer {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady(): void;
        onStateChange(event: { data: number }): void;
        onError(event: { data: number }): void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YouTubeEvents {
  play(): void;
  pause(): void;
  buffering(): void;
  ended(): void;
  time(current: number, duration: number): void;
  error(message: string): void;
}

const POLL_MS = 250;

let api: Promise<YTNamespace> | null = null;
let dock: HTMLDivElement | null = null;
let player: Promise<YTPlayer> | null = null;
let poll: number | undefined;
let handlers: YouTubeEvents | null = null;
let active = false;

/** The video id in a YouTube link (https://www.youtube.com/watch?v=…). */
export function videoIdOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get('v');
  } catch {
    return null;
  }
}

function loadApi(): Promise<YTNamespace> {
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      api = null;
      reject(new Error('Не удалось загрузить плеер YouTube — проверьте подключение к интернету'));
    };
    document.head.append(script);
  });
  return api;
}

function describeError(code: number): string {
  switch (code) {
    case 2:
      return 'YouTube: неверная ссылка на видео';
    case 5:
      return 'Плеер YouTube не смог воспроизвести это видео';
    case 100:
      return 'Видео удалено с YouTube или скрыто';
    case 101:
    case 150:
      return 'Владелец видео запретил смотреть его вне YouTube';
    default:
      return `Плеер YouTube сообщил об ошибке ${code}`;
  }
}

function showDock(visible: boolean) {
  if (dock) dock.hidden = !visible;
  document.documentElement.classList.toggle('yt-docked', visible);
}

function startPolling(p: YTPlayer) {
  window.clearInterval(poll);
  poll = window.setInterval(() => handlers?.time(p.getCurrentTime(), p.getDuration()), POLL_MS);
}

function stopPolling() {
  window.clearInterval(poll);
  poll = undefined;
}

function createPlayer(videoId: string, startAt: number): Promise<YTPlayer> {
  dock = document.createElement('div');
  dock.className = 'yt-dock';
  const target = document.createElement('div');
  dock.append(target);
  document.body.append(dock);
  return loadApi().then(
    (YT) =>
      new Promise<YTPlayer>((resolve) => {
        const p: YTPlayer = new YT.Player(target, {
          width: '100%',
          height: '100%',
          videoId,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, start: Math.floor(startAt), origin: location.origin },
          events: {
            onReady: () => {
              // Another service's track may have started while YouTube's player was loading.
              if (!active) p.stopVideo();
              resolve(p);
            },
            onStateChange: ({ data }) => {
              if (!active) return;
              if (data === State.Playing) {
                startPolling(p);
                handlers?.play();
              } else if (data === State.Paused || data === State.Cued || data === State.Unstarted) {
                // Cued/unstarted also means the browser did not let the video start by itself.
                stopPolling();
                handlers?.pause();
              } else if (data === State.Buffering) {
                handlers?.buffering();
              } else if (data === State.Ended) {
                stopPolling();
                handlers?.ended();
              }
            },
            onError: ({ data }) => active && handlers?.error(describeError(data)),
          },
        });
      }),
  );
}

function applyVolume(p: YTPlayer, volume: number, muted: boolean) {
  p.setVolume(Math.round(volume * 100));
  if (muted) p.mute();
  else p.unMute();
}

/** Shows the player and starts `videoId`. */
export async function youtubeLoad(videoId: string, startAt: number, volume: number, muted: boolean, events: YouTubeEvents) {
  handlers = events;
  active = true;
  stopPolling();
  if (!player) {
    player = createPlayer(videoId, startAt);
    player.catch(() => {
      player = null;
      dock?.remove();
      dock = null;
    });
    showDock(true);
    applyVolume(await player, volume, muted);
    return;
  }
  showDock(true);
  const p = await player;
  applyVolume(p, volume, muted);
  p.loadVideoById({ videoId, startSeconds: startAt });
}

/** Stops the video and hides the player, when a track from another service starts. */
export function youtubeStop() {
  if (!active) return;
  active = false;
  stopPolling();
  showDock(false);
  void player?.then((p) => p.stopVideo());
}

export function youtubeIsActive() {
  return active;
}

export function youtubePlay() {
  void player?.then((p) => p.playVideo());
}

export function youtubePause() {
  void player?.then((p) => p.pauseVideo());
}

export function youtubeToggle() {
  void player?.then((p) => (p.getPlayerState() === State.Playing ? p.pauseVideo() : p.playVideo()));
}

export function youtubeSeek(seconds: number) {
  void player?.then((p) => p.seekTo(seconds, true));
}

export function youtubeVolume(volume: number, muted: boolean) {
  void player?.then((p) => applyVolume(p, volume, muted));
}
