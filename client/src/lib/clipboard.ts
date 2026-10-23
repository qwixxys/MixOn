import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Clipboard access that also works inside the Android app, whose WebView blocks navigator.clipboard.readText(). On the
 * phone a native plugin (ClipboardPlugin.java) reads and writes the system clipboard; elsewhere the browser's own
 * Clipboard API is used.
 */
interface ClipboardPlugin {
  read(): Promise<{ text: string }>;
  write(options: { text: string }): Promise<void>;
}

const native = Capacitor.isNativePlatform() ? registerPlugin<ClipboardPlugin>('SoundfyClipboard') : null;

/** Whether pasting from the clipboard is possible here. */
export function canPaste(): boolean {
  return Boolean(native) || (typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function');
}

/** The clipboard's text, or throws if it cannot be read. */
export async function pasteText(): Promise<string> {
  if (native) return (await native.read()).text;
  return navigator.clipboard.readText();
}

/** Copies `text` to the clipboard, or throws if it cannot be written. */
export async function copyText(text: string): Promise<void> {
  if (native) return native.write({ text });
  await navigator.clipboard.writeText(text);
}
