// POSIX path helpers for the few path operations the server code does.
export const sep = '/';

export function join(...parts: string[]) {
  return normalize(parts.filter(Boolean).join('/'));
}

export function normalize(p: string) {
  const absolute = p.startsWith('/');
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return (absolute ? '/' : '') + out.join('/');
}

export const resolve = (...parts: string[]) => normalize(['/', ...parts].join('/'));
export const dirname = (p: string) => normalize(p).replace(/\/[^/]*$/, '') || '/';
export const basename = (p: string, ext?: string) => {
  const base = p.replace(/\/+$/, '').split('/').pop() ?? '';
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
};
export const extname = (p: string) => {
  const base = basename(p);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
};
export const parse = (p: string) => {
  const ext = extname(p);
  return { root: p.startsWith('/') ? '/' : '', dir: dirname(p), base: basename(p), ext, name: basename(p, ext) };
};

export default { sep, join, normalize, resolve, dirname, basename, extname, parse };
