// Lists the texts that still lack an English translation: `npm run i18n:check -w client` (CI runs it too).
// Texts come from the interface (client/src) and from the server's messages and genres, which reach the interface as
// data. --missing prints the missing ones as a ready-to-fill block for src/i18n/en.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_GENRES, normalizeGenre } from '../../server/src/lib/genres.ts';
import { EN } from '../src/i18n/en.ts';
import { translateSource } from './transform.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
/** Server files whose texts never reach the interface: logging, and the spellings genres are matched by. */
const SERVER_SKIP = new Set(['server/src/index.ts', 'server/src/lib/genres.ts', 'server/src/lib/matching.ts']);
/** Messages from the Android app's own code (mobile/android/…/*.java). */
const NATIVE = ['Буфер обмена недоступен', 'Это не страница ВКонтакте'];

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) yield path;
  }
}

const found = new Map<string, string>();
const add = (key: string, where: string) => {
  if (!found.has(key)) found.set(key, where);
};
for (const [dir, skip] of [
  ['client/src', (f: string) => f.startsWith('client/src/i18n/')],
  ['server/src', (f: string) => SERVER_SKIP.has(f)],
] as const) {
  for (const path of files(join(root, dir))) {
    const file = relative(root, path).replace(/\\/g, '/');
    if (skip(file)) continue;
    for (const { key, line } of translateSource(readFileSync(path, 'utf8'), file).keys) add(key, `${file}:${line}`);
  }
}
for (const genre of KNOWN_GENRES) add(genre, 'server/src/lib/genres.ts (genre)');
for (const text of NATIVE) add(text, 'mobile/android (native)');

const placeholders = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort().join();
const missing = [...found].filter(([key]) => EN[key] === undefined);
const broken = [...found].filter(([key]) => EN[key] !== undefined && placeholders(key) !== placeholders(EN[key]));
const unused = Object.keys(EN).filter((key) => !found.has(key));
// A genre typed or picked in English has to land in the same family as its Russian name.
const genres = KNOWN_GENRES.filter((genre) => EN[genre] !== undefined && normalizeGenre(EN[genre]) !== genre);

if (process.argv.includes('--missing')) {
  for (const [key, where] of missing) console.log(`  // ${where}\n  ${JSON.stringify(key)}: '',`);
  process.exit(0);
}
for (const [key, where] of missing) console.log(`no translation: ${JSON.stringify(key)}  (${where})`);
for (const [key, where] of broken) console.log(`placeholders differ: ${JSON.stringify(key)} → ${JSON.stringify(EN[key])}  (${where})`);
for (const key of unused) console.log(`unused: ${JSON.stringify(key)}`);
for (const genre of genres) console.log(`genre ${JSON.stringify(EN[genre])} is not recognised as ${genre}: add it to server/src/lib/genres.ts`);
console.log(`${found.size} texts, ${missing.length} without a translation, ${broken.length} with wrong placeholders, ${unused.length} unused`);
if (missing.length || broken.length || unused.length || genres.length) process.exit(1);
