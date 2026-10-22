import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { FetchLike } from '../../../server/src/lib/http';

/** Statuses whose responses may not carry a body (the Response constructor throws otherwise). */
const NO_BODY = new Set([101, 103, 204, 205, 304]);

function headersObject(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((value, key) => (out[key] = value));
  return out;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * fetch() for the music services' APIs. Inside the Android app requests go through the native HTTP client, which
 * CORS does not apply to, so the server code can call Deezer, SoundCloud, LRCLIB… as it does on a computer. Elsewhere
 * (a desktop browser, the tests) it is the page's own fetch.
 */
export function createNativeFetch(pageFetch: typeof fetch): FetchLike {
  if (!Capacitor.isNativePlatform()) return (input, init) => pageFetch(input, init);

  return async (input, init = {}) => {
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw abortError(signal);
    const headers = headersObject(init.headers);
    let data: string | undefined;
    if (init.body instanceof URLSearchParams) {
      data = init.body.toString();
      headers['content-type'] ??= 'application/x-www-form-urlencoded;charset=UTF-8';
    } else if (typeof init.body === 'string') {
      data = init.body;
    } else if (init.body != null) {
      throw new TypeError('nativeFetch: only text bodies are supported');
    }

    const request = CapacitorHttp.request({
      url: input,
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      data,
      responseType: 'text',
      disableRedirects: init.redirect === 'manual',
      connectTimeout: 15_000,
      readTimeout: 30_000,
    });
    const res = await (signal
      ? Promise.race([
          request,
          new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(abortError(signal)), { once: true })),
        ])
      : request);

    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(res.headers ?? {})) {
      try {
        responseHeaders.set(key, String(value));
      } catch {
        // the status line comes back under an empty or "null" name on Android
      }
    }
    // JSON responses arrive already parsed; the server code wants the text, as from fetch().
    const text = res.data == null ? '' : typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return new Response(NO_BODY.has(res.status) ? null : text, { status: res.status, headers: responseHeaders });
  };
}
