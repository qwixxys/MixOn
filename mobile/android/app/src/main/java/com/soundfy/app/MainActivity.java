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
 * The app opens with a bundled page where the listener enters the address of their soundFy server (the desktop app
 * on the same Wi-Fi, or a hosted server) and then shows that server's web interface.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new ServerWebViewClient(bridge));

        // Back goes through the pages visited in the app, and leaves the app only from the first one.
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    WebView webView = bridge.getWebView();
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                }
            }
        );
    }

    /**
     * The server address is only known at run time, so Capacitor's static allowNavigation list cannot describe it.
     * Instead: the bundled start page may open any server, and that server's pages stay in the app. A service's
     * sign-in pages also stay in the app until they send the listener back to the server. Every other site (Genius,
     * the services' pages) opens in the browser.
     */
    static class ServerWebViewClient extends BridgeWebViewClient {

        /** Sign-in pages for connecting a service account (see client/src/pages/SyncPage.tsx). */
        private static final Set<String> LOGIN_HOSTS = new HashSet<>(
            Arrays.asList("secure.soundcloud.com", "soundcloud.com", "api.soundcloud.com")
        );

        private final Bridge bridge;
        /** The server the start page opened, e.g. http://192.168.1.10:4777. */
        private Uri server;
        /** True from a service's sign-in page until it returns to the server. */
        private boolean signingIn;

        ServerWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri target = request.getUrl();
            String scheme = target.getScheme();
            Uri app = appUri();
            boolean web = "http".equals(scheme) || "https".equals(scheme);
            if (!web || sameOrigin(target, app)) {
                return super.shouldOverrideUrlLoading(view, request);
            }
            String current = view.getUrl();
            Uri from = current == null ? null : Uri.parse(current);
            if (from != null && sameOrigin(from, app)) {
                // The start page opens the server the listener chose.
                server = originOf(target);
                signingIn = false;
                return false;
            }
            if (server != null && sameOrigin(target, server)) {
                signingIn = false;
                return false;
            }
            if (server != null && from != null && sameOrigin(from, server) && sameHost(target, server)) {
                // The server moved itself to another scheme or port (for example http → https).
                server = originOf(target);
                return false;
            }
            if (LOGIN_HOSTS.contains(target.getHost()) || (signingIn && "https".equals(scheme))) {
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

        /** When the server's page cannot be shown, go back to the start page instead of a dead end. */
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
            view.loadUrl(appUri().buildUpon().path("/").encodedQuery("change=1&failed=1").build().toString());
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
