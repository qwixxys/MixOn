package com.soundfy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Keeps the music playing while the app is in the background and shows it in the notification shade, on the lock
 * screen and in the live-activity capsules of One UI, Xiaomi and others: a media session with the track, its cover,
 * play/pause, previous/next and a seek bar. The player itself stays in the page (client/src/store/player.ts); this
 * service only mirrors it, and hands the buttons pressed here back to it through MediaNotificationPlugin.
 *
 * The WebView's own Media Session API shows nothing on Android, unlike Chrome, which is why this exists.
 */
public class PlaybackService extends Service {

    /** What the notification shows; sent by the page through MediaNotificationPlugin. */
    static class Track {
        String title = "";
        String artist = "";
        String album = "";
        String artwork;
        boolean playing;
        boolean loading;
        long positionMs;
        long durationMs;
    }

    /** Where the buttons pressed in the notification go. */
    interface Listener {
        void onAction(String action, double positionSeconds);
    }

    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 4711;
    private static final String ACTION_PLAY = "com.soundfy.app.PLAY";
    private static final String ACTION_PAUSE = "com.soundfy.app.PAUSE";
    private static final String ACTION_NEXT = "com.soundfy.app.NEXT";
    private static final String ACTION_PREVIOUS = "com.soundfy.app.PREVIOUS";
    /** A paused track stays in the shade this long, then the notification goes away (as in other music apps). */
    private static final long PAUSED_TIMEOUT_MS = 10 * 60 * 1000;

    /** The running service, if any; touched on the main thread only. */
    static PlaybackService instance;
    /** The track to show once the service has started. */
    static Track pending;
    static Listener listener;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService artworkLoader = Executors.newSingleThreadExecutor();
    private final Runnable stopWhenPaused = this::finish;
    private MediaSession session;
    private Track track;
    private String artworkUrl;
    private Bitmap artwork;
    private boolean foreground;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL,
                getString(R.string.playback_channel),
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setShowBadge(false);
            notifications().createNotificationChannel(channel);
        }
        session = new MediaSession(this, "MixOn");
        session.setSessionActivity(openApp());
        session.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    send("play", 0);
                }

                @Override
                public void onPause() {
                    send("pause", 0);
                }

                @Override
                public void onStop() {
                    send("pause", 0);
                }

                @Override
                public void onSkipToNext() {
                    send("next", 0);
                }

                @Override
                public void onSkipToPrevious() {
                    send("previous", 0);
                }

                @Override
                public void onSeekTo(long positionMs) {
                    send("seekto", positionMs / 1000.0);
                }
            }
        );
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PLAY.equals(action)) send("play", 0);
        else if (ACTION_PAUSE.equals(action)) send("pause", 0);
        else if (ACTION_NEXT.equals(action)) send("next", 0);
        else if (ACTION_PREVIOUS.equals(action)) send("previous", 0);
        else if (pending != null) {
            show(pending);
            pending = null;
        }
        return START_NOT_STICKY;
    }

    /** Shows `next` in the session and the notification. */
    void show(Track next) {
        track = next;
        main.removeCallbacks(stopWhenPaused);
        if (!next.playing && !next.loading) main.postDelayed(stopWhenPaused, PAUSED_TIMEOUT_MS);
        loadArtwork(next.artwork);

        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, next.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, next.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, next.album);
        if (next.durationMs > 0) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, next.durationMs);
        if (artwork != null) metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(metadata.build());

        int state = next.loading ? PlaybackState.STATE_BUFFERING : next.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        session.setPlaybackState(
            new PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY |
                    PlaybackState.ACTION_PAUSE |
                    PlaybackState.ACTION_PLAY_PAUSE |
                    PlaybackState.ACTION_SKIP_TO_NEXT |
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                    PlaybackState.ACTION_SEEK_TO |
                    PlaybackState.ACTION_STOP
                )
                .setState(state, next.positionMs, next.playing ? 1f : 0f)
                .build()
        );

        Notification notification = buildNotification(next);
        if (!foreground) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                foreground = true;
                return;
            } catch (RuntimeException notAllowedNow) {
                // Android refuses a foreground start from the background in some cases; show the notification anyway.
            }
        }
        notifications().notify(NOTIFICATION_ID, notification);
    }

    /** Posts the notification again as it is, for when notifications have just been allowed. */
    void repost() {
        if (track != null) notifications().notify(NOTIFICATION_ID, buildNotification(track));
    }

    /** Removes the notification and stops; the next track played starts it again. */
    void finish() {
        main.removeCallbacks(stopWhenPaused);
        // Nothing to post again while the service stops.
        track = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        notifications().cancel(NOTIFICATION_ID);
        foreground = false;
        stopSelf();
    }

    private Notification buildNotification(Track t) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        builder
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(t.title)
            .setContentText(t.artist)
            .setSubText(t.album.isEmpty() ? null : t.album)
            .setContentIntent(openApp())
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(t.playing || t.loading)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(action(android.R.drawable.ic_media_previous, R.string.playback_previous, ACTION_PREVIOUS, 1))
            .addAction(
                t.playing
                    ? action(android.R.drawable.ic_media_pause, R.string.playback_pause, ACTION_PAUSE, 2)
                    : action(android.R.drawable.ic_media_play, R.string.playback_play, ACTION_PLAY, 3)
            )
            .addAction(action(android.R.drawable.ic_media_next, R.string.playback_next, ACTION_NEXT, 4))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (artwork != null) builder.setLargeIcon(artwork);
        return builder.build();
    }

    /** A notification button; newer Android versions draw their own from the session and ignore these. */
    private Notification.Action action(int icon, int title, String action, int requestCode) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        PendingIntent pending = PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), getString(title), pending).build();
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Loads the cover off the main thread, then shows the track again with it. */
    private void loadArtwork(String url) {
        if (url == null || url.isEmpty()) {
            artworkUrl = null;
            artwork = null;
            return;
        }
        if (url.equals(artworkUrl)) return;
        artworkUrl = url;
        artwork = null;
        artworkLoader.execute(() -> {
            Bitmap bitmap = download(url);
            main.post(() -> {
                if (bitmap == null || !url.equals(artworkUrl) || instance != this || track == null) return;
                artwork = bitmap;
                show(track);
            });
        });
    }

    private static Bitmap download(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            try (InputStream in = connection.getInputStream()) {
                Bitmap bitmap = BitmapFactory.decodeStream(in);
                // The system scales the cover down anyway; a smaller one keeps the session light.
                if (bitmap != null && bitmap.getWidth() > 512) {
                    int height = Math.round(bitmap.getHeight() * 512f / bitmap.getWidth());
                    bitmap = Bitmap.createScaledBitmap(bitmap, 512, Math.max(height, 1), true);
                }
                return bitmap;
            }
        } catch (Exception failed) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void send(String action, double positionSeconds) {
        if (listener != null) listener.onAction(action, positionSeconds);
    }

    private NotificationManager notifications() {
        return (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    }

    /** The app was swiped away: the page and its player are gone, so is the notification. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        finish();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(stopWhenPaused);
        artworkLoader.shutdownNow();
        session.setActive(false);
        session.release();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
