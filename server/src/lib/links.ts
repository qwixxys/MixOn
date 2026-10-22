import { badRequest } from './errors.js';
import type { FetchLike } from './http.js';

const MAX_HOPS = 4;
/** Share-link pages that carry their target in the query (link.deezer.com/?dest=…, old Firebase links ?link=…). */
const TARGET_PARAMS = ['dest', 'link', 'awf', 'gwf', 'iwf'];

function parse(input: string): URL {
  let url: URL;
  const text = input.trim();
  try {
    // Links copied from an address bar or a share sheet often come without the scheme.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw badRequest('Это не похоже на ссылку');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('Нужна ссылка http(s)');
  url.protocol = 'https:';
  url.hash = '';
  return url;
}

/**
 * Turns a pasted link into a canonical URL, following redirects of share links such as
 * on.soundcloud.com/… or link.deezer.com/s/…. Only hosts in `shortLinkHosts` are ever fetched,
 * so a pasted link cannot make the server request arbitrary addresses.
 */
export async function expandLink(input: string, shortLinkHosts: string[], fetchImpl: FetchLike): Promise<URL> {
  let url = parse(input);
  for (let hop = 0; hop < MAX_HOPS && shortLinkHosts.includes(url.hostname); hop++) {
    // The target is already in the link: use it without a request. It is checked like any pasted link afterwards.
    const target = TARGET_PARAMS.map((p) => url.searchParams.get(p)).find((v) => v && /^https?:\/\//i.test(v));
    if (target) {
      url = parse(target);
      continue;
    }
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    } catch {
      throw badRequest('Не удалось открыть короткую ссылку');
    }
    await res.body?.cancel().catch(() => {});
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) {
      throw badRequest('Короткая ссылка не открывается: она устарела или удалена. Скопируйте ссылку в сервисе заново');
    }
    url = parse(new URL(location, url).toString());
  }
  return url;
}
