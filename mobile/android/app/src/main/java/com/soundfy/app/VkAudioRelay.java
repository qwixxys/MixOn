package com.soundfy.app;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Loads VK audio for the WebView. VK hands out audio links only to its official apps and binds them to the client
 * that asked, so the phone fetches the audio itself with the same User-Agent its VK API requests use, instead of the
 * WebView's own. This serves both the &lt;audio&gt; element (with Range requests for seeking) and HLS playlists,
 * segments and keys loaded by hls.js, which also need CORS headers because the app's page is http://localhost.
 * A soundFy server does the same by relaying VK audio (server/src/routes/tracks.ts).
 */
final class VkAudioRelay {

    /** Must match VK_USER_AGENT in server/src/providers/vk.ts. */
    static final String VK_USER_AGENT =
        "KateMobileAndroid/56 lite-460 (Android 4.4.2; SDK 19; x86; unknown Android SDK built for x86; en)";

    private static final String[] AUDIO_HOSTS = { ".vkuseraudio.net", ".vkuseraudio.com" };
    private static final String[] FORWARDED_HEADERS = { "Range", "If-Range", "Accept" };
    private static final String[] RETURNED_HEADERS = {
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "Last-Modified",
        "ETag",
        "Cache-Control",
    };

    private VkAudioRelay() {}

    static boolean handles(Uri url) {
        String host = url.getHost();
        if (host == null || !"https".equalsIgnoreCase(url.getScheme())) return false;
        host = host.toLowerCase(Locale.ROOT);
        for (String suffix : AUDIO_HOSTS) {
            if (host.endsWith(suffix)) return true;
        }
        return false;
    }

    /** The response to give the WebView, or null to let it load the address the usual way. */
    static WebResourceResponse fetch(WebResourceRequest request) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
        String method = request.getMethod().toUpperCase(Locale.ROOT);
        if (method.equals("OPTIONS")) {
            headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            headers.put("Access-Control-Allow-Headers", "*");
            return new WebResourceResponse("text/plain", null, 204, "No Content", headers, new ByteArrayInputStream(new byte[0]));
        }
        if (!method.equals("GET") && !method.equals("HEAD")) return null;

        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("User-Agent", VK_USER_AGENT);
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                for (String name : FORWARDED_HEADERS) {
                    if (name.equalsIgnoreCase(header.getKey())) connection.setRequestProperty(name, header.getValue());
                }
            }

            int status = connection.getResponseCode();
            // WebResourceResponse cannot carry redirects; HttpURLConnection follows those within https itself.
            if (status >= 300 && status < 400) {
                connection.disconnect();
                return null;
            }
            for (String name : RETURNED_HEADERS) {
                String value = connection.getHeaderField(name);
                if (value != null) headers.put(name, value);
            }
            String type = connection.getContentType();
            String mimeType = type == null ? "application/octet-stream" : type.split(";")[0].trim();
            String reason = connection.getResponseMessage();
            if (reason == null || reason.isEmpty()) reason = status < 400 ? "OK" : "Error";
            InputStream body = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (body == null) body = new ByteArrayInputStream(new byte[0]);
            return new WebResourceResponse(mimeType, null, status, reason, headers, body);
        } catch (IOException e) {
            return null;
        }
    }
}
