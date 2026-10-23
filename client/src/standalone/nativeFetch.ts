import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { FetchLike } from '../../../server/src/lib/http';

/** Statuses whose responses may not carry a body (the Response constructor throws otherwise). */
const NO_BODY = new Set([101, 103, 204, 205, 304]);

function headersObject(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((value, key) => (out[key] = value));
  return out;
}

/** Android hands binary bodies over as base64 (with line breaks, which atob skips). */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * The body as fetch() would give it. Successful responses are asked for as binary, so audio downloads arrive intact
 * and text is decoded from the same bytes; JSON comes already parsed and error pages as text.
 */
function bodyOf(data: unknown, status: number, type: string): BodyInit {
  if (data == null) return '';
  // A JSON document that is a bare string comes back parsed, i.e. unquoted.
  if (typeof data === 'string' && type.includes('json')) return JSON.stringify(data);
  if (typeof data === 'string') return status >= 400 ? data : fromBase64(data);
  if (data instanceof ArrayBuffer) return data;
  return JSON.stringify(data);
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
      responseType: 'arraybuffer',
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
    return new Response(NO_BODY.has(res.status) ? null : bodyOf(res.data, res.status, responseHeaders.get('content-type') ?? ''), { status: res.status, headers: responseHeaders });
  };
}
