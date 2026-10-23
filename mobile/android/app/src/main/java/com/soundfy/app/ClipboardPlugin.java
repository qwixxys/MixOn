package com.soundfy.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reads and writes the system clipboard from native code. The WebView blocks navigator.clipboard.readText(), so in
 * the app the paste and copy buttons go through here instead (client/src/lib/clipboard.ts).
 */
@CapacitorPlugin(name = "SoundfyClipboard")
public class ClipboardPlugin extends Plugin {

    @PluginMethod
    public void read(PluginCall call) {
        ClipboardManager manager = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        String text = "";
        if (manager != null && manager.hasPrimaryClip()) {
            ClipData clip = manager.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence value = clip.getItemAt(0).coerceToText(getContext());
                if (value != null) text = value.toString();
            }
        }
        JSObject result = new JSObject();
        result.put("text", text);
        call.resolve(result);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String text = call.getString("text", "");
        ClipboardManager manager = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (manager == null) {
            call.reject("Буфер обмена недоступен");
            return;
        }
        manager.setPrimaryClip(ClipData.newPlainText("soundFy", text));
        call.resolve();
    }
}
