import { relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { translateSource } from './i18n/transform';

const backend = process.env.SOUNDFY_API ?? 'http://localhost:4000';
const shim = (name: string) => fileURLToPath(new URL(`./src/standalone/shims/${name}.ts`, import.meta.url));

/**
 * `vite build --mode standalone` builds the Android app that works without a computer: the server's code runs in the
 * page (src/standalone/boot.ts), with these stand-ins for the Node-only packages it imports.
 */
const standaloneAliases = [
  ['better-sqlite3', 'better-sqlite3'],
  ['express', 'express'],
  ['multer', 'multer'],
  ['jsonwebtoken', 'jsonwebtoken'],
  ['music-metadata', 'music-metadata'],
  ['node:fs', 'node-fs'],
  ['node:path', 'node-path'],
  ['node:crypto', 'node-crypto'],
  ['node:stream', 'node-stream'],
  ['node:stream/promises', 'node-stream'],
].map(([find, file]) => ({ find: new RegExp(`^${find}$`), replacement: shim(file) }));

/** The standalone build starts from its own entry, which boots the in-page server before the app. */
const standaloneEntry: Plugin = {
  name: 'soundfy-standalone-entry',
  // "pre", so the entry is swapped before Vite collects the page's scripts.
  transformIndexHtml: { order: 'pre', handler: (html) => html.replace('/src/main.tsx', '/src/standalone/entry.ts') },
};

const sources = fileURLToPath(new URL('./src/', import.meta.url));
const dictionaries = fileURLToPath(new URL('./src/i18n/', import.meta.url));
/** path.relative, so drive-letter case and slashes on Windows do not matter. */
const inside = (dir: string, file: string) => {
  const rel = relative(dir, file);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
};

/** The English interface: Russian texts in the source are looked up in src/i18n/en.ts (see i18n/transform.ts). */
const translations: Plugin = {
  name: 'mixon-i18n',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0];
    if (!/\.tsx?$/.test(file) || !inside(sources, file) || inside(dictionaries, file)) return null;
    const translated = translateSource(code, file).code;
    // On the first line, so the lines stay where they are in the source.
    return translated && { code: `import { __t } from '/src/i18n/runtime.ts';${translated}`, map: null };
  },
};

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    plugins: standalone ? [translations, react(), standaloneEntry] : [translations, react()],
    resolve: standalone ? { alias: standaloneAliases } : undefined,
    define: standalone ? { 'import.meta.env.VITE_STANDALONE': JSON.stringify('1') } : undefined,
    // The standalone build goes straight into the Android project, together with the page for connecting to a server.
    publicDir: standalone ? '../mobile/public' : 'public',
    build: {
      // hls.js is loaded lazily, only for HLS streams (some VK and SoundCloud tracks).
      chunkSizeWarningLimit: standalone ? 1200 : 600,
      ...(standalone ? { outDir: '../mobile/www', emptyOutDir: true } : {}),
    },
    server: {
      port: 5173,
      proxy: { '/api': backend, '/media': backend },
    },
  };
});
