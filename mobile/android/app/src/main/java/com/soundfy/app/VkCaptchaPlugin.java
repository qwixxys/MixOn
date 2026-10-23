package com.soundfy.app;

import android.app.Dialog;
import android.net.Uri;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.Locale;

/**
 * VK's "not a robot" check when signing in to VK (VK ID captcha). Its page cannot be shown inside soundFy's page, so
 * the app opens it in a window of its own. When the listener passes it, VK's page gets a success_token from
 * api.vk.com (captchaNotRobot.check); a script in the window reads it and open() resolves with it, and soundFy repeats
 * the sign-in with the token. Closing the window resolves with no token. Used by client/src/lib/vkCaptcha.ts.
 */
@CapacitorPlugin(name = "VkCaptcha")
public class VkCaptchaPlugin extends Plugin {

    private static final String RESULT_BRIDGE = "SoundfyCaptchaResult";

    /** Watches the page's requests for the answer that carries success_token. */
    private static final String HOOK =
        "(function(){if(window.__soundfyCaptchaHook)return;window.__soundfyCaptchaHook=true;" +
        "function check(t){try{var d=JSON.parse(t);var s=d&&d.response&&d.response.success_token;" +
        "if(s&&window." + RESULT_BRIDGE + ")window." + RESULT_BRIDGE + ".done(String(s));}catch(e){}}" +
        "var f=window.fetch;if(f){window.fetch=function(){return f.apply(this,arguments).then(function(r){" +
        "try{r.clone().text().then(check,function(){});}catch(e){}return r;});};}" +
        "var send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){" +
        "this.addEventListener('load',function(){try{check(this.responseText);}catch(e){}});" +
        "return send.apply(this,arguments);};})();";

    private Dialog dialog;
    private PluginCall pending;

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !isVkPage(Uri.parse(url))) {
            call.reject("Это не страница ВКонтакте");
            return;
        }
        getActivity().runOnUiThread(() -> show(url, call));
    }

    static boolean isVkPage(Uri uri) {
        String host = uri.getHost();
        if (host == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals("vk.com") || host.endsWith(".vk.com") || host.equals("vk.ru") || host.endsWith(".vk.ru");
    }

    /** Called by the script in VK's window, on a background thread. */
    public class Result {

        @JavascriptInterface
        public void done(String token) {
            getActivity().runOnUiThread(() -> finish(token));
        }
    }

    private void show(String url, PluginCall call) {
        finish(null);
        pending = call;
        WebView web = new WebView(getActivity());
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Result(), RESULT_BRIDGE);
        // Before VK's scripts run and in its frames too, where supported; otherwise once each page has loaded.
        boolean early = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (early) WebViewCompat.addDocumentStartJavaScript(web, HOOK, Collections.singleton("*"));
        web.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    // Only VK's own pages open in this window.
                    return request.isForMainFrame() && !isVkPage(request.getUrl());
                }

                @Override
                public void onPageFinished(WebView view, String loaded) {
                    if (!early) view.evaluateJavascript(HOOK, null);
                }
            }
        );

        Dialog window = new Dialog(getActivity(), android.R.style.Theme_DeviceDefault_NoActionBar);
        window.setContentView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // The back button closes the window without a token.
        window.setOnDismissListener(d -> {
            web.destroy();
            if (dialog == window) finish(null);
        });
        dialog = window;
        window.show();
        Window frame = window.getWindow();
        if (frame != null) frame.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        web.loadUrl(url);
    }

    /** Answers the waiting call (null: no token) and closes the window. */
    private void finish(String token) {
        PluginCall call = pending;
        pending = null;
        Dialog window = dialog;
        dialog = null;
        if (call != null) {
            JSObject result = new JSObject();
            result.put("token", token);
            call.resolve(result);
        }
        if (window != null) window.dismiss();
    }
}
