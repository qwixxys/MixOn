package com.soundfy.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
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

    private static final int NOTIFICATIONS_REQUEST = 4712;

    private final Handler main = new Handler(Looper.getMainLooper());
    /** Asked once per launch; Android itself stops asking after the listener says no twice. */
    private boolean askedForNotifications;

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
            askForNotifications();
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

    /**
     * Android 13+ shows the playing track in the shade without this permission, but some phones do not (vivo's
     * OriginOS, for one), so it is asked for when the first track plays.
     */
    private void askForNotifications() {
        if (askedForNotifications || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        askedForNotifications = true;
        Activity activity = getActivity();
        if (activity == null || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        activity.requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATIONS_REQUEST);
    }

    /** Back in the app, e.g. from that permission's dialog or the settings: the track goes to the shade again. */
    @Override
    protected void handleOnResume() {
        main.post(() -> {
            if (PlaybackService.instance != null) PlaybackService.instance.repost();
        });
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
