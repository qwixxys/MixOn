package com.soundfy.app;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The page's player tells PlaybackService what is playing (client/src/lib/mediaNotification.ts), and the buttons
 * pressed in the notification, on headphones or on the lock screen come back as "action" events.
 */
@CapacitorPlugin(name = "MixOnMediaNotification")
public class MediaNotificationPlugin extends Plugin implements PlaybackService.Listener {

    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        PlaybackService.listener = this;
    }

    @PluginMethod
    public void update(PluginCall call) {
        PlaybackService.Track track = new PlaybackService.Track();
        track.title = call.getString("title", "");
        track.artist = call.getString("artist", "");
        track.album = call.getString("album", "");
        track.artwork = call.getString("artwork");
        track.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        track.loading = Boolean.TRUE.equals(call.getBoolean("loading", false));
        track.positionMs = Math.round(call.getDouble("position", 0.0) * 1000);
        track.durationMs = Math.round(call.getDouble("duration", 0.0) * 1000);
        main.post(() -> {
            if (PlaybackService.instance != null) {
                PlaybackService.instance.show(track);
                return;
            }
            // Only a played track starts the notification, and playing starts in the app, which is in front then.
            if (!track.playing && !track.loading) return;
            PlaybackService.pending = track;
            try {
                getContext().startService(new Intent(getContext(), PlaybackService.class));
            } catch (IllegalStateException inBackground) {
                PlaybackService.pending = null;
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        main.post(() -> {
            if (PlaybackService.instance != null) PlaybackService.instance.finish();
        });
        call.resolve();
    }

    @Override
    public void onAction(String action, double positionSeconds) {
        JSObject event = new JSObject();
        event.put("action", action);
        event.put("position", positionSeconds);
        notifyListeners("action", event);
    }

    /** The app is closing: its page and player go with it. */
    @Override
    protected void handleOnDestroy() {
        if (PlaybackService.listener == this) PlaybackService.listener = null;
        main.post(() -> {
            if (PlaybackService.instance != null) PlaybackService.instance.finish();
        });
    }
}
