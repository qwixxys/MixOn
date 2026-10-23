import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { usePlayer } from '../store/player';

/**
 * The playing track in Android's notification shade, lock screen and live-activity capsule, with its buttons. The
 * Android app's WebView shows nothing for the Web Media Session API (Chrome does), so in the app a native service
 * does it (mobile/android/…/PlaybackService.java) and sends the buttons pressed there back here.
 */
interface MediaNotificationPlugin {
  update(track: {
    title: string;
    artist: string;
    album: string;
    artwork: string | null;
    playing: boolean;
    loading: boolean;
    position: number;
    duration: number;
  }): Promise<void>;
  clear(): Promise<void>;
  addListener(event: 'action', listener: (e: { action: string; position: number }) => void): Promise<PluginListenerHandle>;
}

const native = Capacitor.isNativePlatform() ? registerPlugin<MediaNotificationPlugin>('MixOnMediaNotification') : null;

if (native) {
  const player = () => usePlayer.getState();
  void native.addListener('action', ({ action, position }) => {
    const st = player();
    if (action === 'play' && !st.playing) st.toggle();
    else if (action === 'pause' && st.playing) st.toggle();
    else if (action === 'next') st.next();
    else if (action === 'previous') st.prev();
    else if (action === 'seekto') st.seek(position);
  });

  // The service counts the position on by itself while playing, so it hears again only when that count would drift:
  // a new track, play/pause, loading, a seek.
  let sent = { at: 0, position: 0, playing: false };
  const send = () => {
    const { current, playing, loading, currentTime, duration } = player();
    if (!current) {
      void native.clear().catch(() => {});
      return;
    }
    sent = { at: Date.now(), position: currentTime, playing };
    void native
      .update({
        title: current.title,
        artist: current.artist,
        album: current.album ?? '',
        artwork: current.coverUrl ? new URL(current.coverUrl, location.href).href : null,
        playing,
        loading,
        position: currentTime,
        duration: duration || current.duration || 0,
      })
      .catch(() => {});
  };
  usePlayer.subscribe((st, prev) => {
    if (
      st.current?.id !== prev.current?.id ||
      st.playing !== prev.playing ||
      st.loading !== prev.loading ||
      Math.abs(st.duration - prev.duration) > 1
    ) {
      send();
      return;
    }
    if (st.current && st.currentTime !== prev.currentTime) {
      const expected = sent.position + (sent.playing ? (Date.now() - sent.at) / 1000 : 0);
      if (Math.abs(st.currentTime - expected) > 2) send();
    }
  });
}
