package com.soundfy.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * The app opens with a bundled page where the listener enters the address of their soundFy server (the desktop app
 * on the same Wi-Fi, or a hosted server) and then shows that server's web interface.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new ServerWebViewClient(bridge));
    }

    /**
     * The server address is only known at run time, so Capacitor's static allowNavigation list cannot describe it.
     * Instead: the bundled page may open any server, a server's pages stay in the app, and every other site
     * (Genius, the services' pages, login pages) opens in the browser.
     */
    static class ServerWebViewClient extends BridgeWebViewClient {

        private final Bridge bridge;

        ServerWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri target = request.getUrl();
            String scheme = target.getScheme();
            Uri app = Uri.parse(bridge.getAppUrl());
            boolean web = "http".equals(scheme) || "https".equals(scheme);
            if (!web || sameOrigin(target, app)) {
                return super.shouldOverrideUrlLoading(view, request);
            }
            String current = view.getUrl();
            Uri from = current == null ? null : Uri.parse(current);
            if (from != null && (sameOrigin(from, app) || sameOrigin(from, target))) {
                return false;
            }
            try {
                view.getContext().startActivity(new Intent(Intent.ACTION_VIEW, target));
            } catch (ActivityNotFoundException ignored) {
                // No browser installed: stay on the current page.
            }
            return true;
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

        private static int port(Uri uri) {
            if (uri.getPort() != -1) return uri.getPort();
            return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
        }
    }
}
