package com.soundfy.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * The app runs soundFy by itself: the bundled page (www/index.html) contains the server's code and keeps the
 * listener's data on the phone. From its menu the listener can instead connect to a soundFy server (the desktop app
 * on the same Wi-Fi, or a hosted server) on the bundled connect.html page, and the app then shows that server.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VkCaptchaPlugin.class);
        registerPlugin(ClipboardPlugin.class);
        registerPlugin(MediaNotificationPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new ServerWebViewClient(bridge));

        // Back goes through the pages visited in the app; from the first one it puts the app in the background, like
        // Home, so the music keeps playing instead of stopping with the page.
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    WebView webView = bridge.getWebView();
                    if (webView.canGoBack()) webView.goBack();
                    else moveTaskToBack(true);
                }
            }
        );
    }

    /** Also called by Capacitor with the intent the app was started with. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openSpotifyCallback(intent);
    }

    /**
     * After signing in to Spotify in the browser, Spotify sends the listener to mixon://spotify-callback?code=…&state=…
     * (server/src/lib/spotifyAccount.ts). The services page finishes the sign-in with what it brings.
     */
    private void openSpotifyCallback(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (bridge == null || data == null || !"mixon".equals(data.getScheme()) || !"spotify-callback".equals(data.getHost())) return;
        // Handled once, not again when the activity is recreated.
        intent.setData(null);
        Uri.Builder page = Uri.parse(bridge.getAppUrl()).buildUpon().path("/sync").clearQuery().fragment(null);
        for (String key : new String[] { "code", "state", "error" }) {
            String value = data.getQueryParameter(key);
            if (value != null) page.appendQueryParameter("spotify_" + key, value);
        }
        bridge.getWebView().loadUrl(page.build().toString());
    }

    /**
     * The server address is only known at run time, so Capacitor's static allowNavigation list cannot describe it.
     * Instead: the bundled connect page may open any server, and that server's pages stay in the app. A service's
     * sign-in pages started from the server also stay in the app until they send the listener back to it. Every other
     * site (Genius, the services' pages, links in the app itself) opens in the browser.
     */
    static class ServerWebViewClient extends BridgeWebViewClient {

        /** The bundled page where the listener picks a server. */
        private static final String CONNECT_PAGE = "/connect.html";

        /** Sign-in pages for connecting a service account (see client/src/pages/SyncPage.tsx). */
        private static final Set<String> LOGIN_HOSTS = new HashSet<>(
            Arrays.asList("secure.soundcloud.com", "soundcloud.com", "api.soundcloud.com", "accounts.spotify.com")
        );

        private final Bridge bridge;
        /** The server the connect page opened, e.g. http://192.168.1.10:4777. */
        private Uri server;
        /** True from a service's sign-in page until it returns to the server. */
        private boolean signingIn;

        ServerWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Frames inside a page (YouTube's player, the Genius widget) load where they are.
            if (!request.isForMainFrame()) return false;
            Uri target = request.getUrl();
            String scheme = target.getScheme();
            Uri app = appUri();
            boolean web = "http".equals(scheme) || "https".equals(scheme);
            if (!web || sameOrigin(target, app)) {
                return super.shouldOverrideUrlLoading(view, request);
            }
            String current = view.getUrl();
            Uri from = current == null ? null : Uri.parse(current);
            boolean fromApp = from != null && sameOrigin(from, app);
            if (fromApp && CONNECT_PAGE.equals(from.getPath())) {
                // The connect page opens the server the listener chose.
                server = originOf(target);
                signingIn = false;
                return false;
            }
            if (!fromApp && server != null && sameOrigin(target, server)) {
                signingIn = false;
                return false;
            }
            if (server != null && from != null && sameOrigin(from, server) && sameHost(target, server)) {
                // The server moved itself to another scheme or port (for example http → https).
                server = originOf(target);
                return false;
            }
            boolean fromServerOrLogin = from != null && !fromApp && server != null;
            if (fromServerOrLogin && (LOGIN_HOSTS.contains(target.getHost()) || (signingIn && "https".equals(scheme)))) {
                signingIn = true;
                return false;
            }
            try {
                view.getContext().startActivity(new Intent(Intent.ACTION_VIEW, target));
            } catch (ActivityNotFoundException ignored) {
                // No browser installed: stay on the current page.
            }
            return true;
        }

        /** VK audio is loaded by the app itself (see VkAudioRelay); everything else as Capacitor does. */
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (VkAudioRelay.handles(request.getUrl())) {
                WebResourceResponse response = VkAudioRelay.fetch(request);
                if (response != null) return response;
            }
            return super.shouldInterceptRequest(view, request);
        }

        /** When the server's page cannot be shown, go back to the connect page instead of a dead end. */
        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) returnToStart(view, request.getUrl());
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            super.onReceivedHttpError(view, request, response);
            if (request.isForMainFrame() && response.getStatusCode() >= 400) returnToStart(view, request.getUrl());
        }

        private void returnToStart(WebView view, Uri failed) {
            if (server == null || !sameOrigin(failed, server)) return;
            view.loadUrl(appUri().buildUpon().path(CONNECT_PAGE).encodedQuery("change=1&failed=1").build().toString());
        }

        private Uri appUri() {
            return Uri.parse(bridge.getAppUrl());
        }

        private static Uri originOf(Uri uri) {
            return uri.buildUpon().path("/").query(null).fragment(null).build();
        }

        private static boolean sameOrigin(Uri a, Uri b) {
            return (
                a.getScheme() != null &&
                a.getScheme().equalsIgnoreCase(b.getScheme()) &&
                a.getHost() != null &&
                a.getHost().equalsIgnoreCase(b.getHost()) &&
                port(a) == port(b)
            );
        }

        private static boolean sameHost(Uri a, Uri b) {
            return a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost());
        }

        private static int port(Uri uri) {
            if (uri.getPort() != -1) return uri.getPort();
            return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
        }
    }
}
