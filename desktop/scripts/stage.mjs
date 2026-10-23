// Assembles build/app: the built server and client, the Electron entry point and the server's runtime dependencies,
// copied from the repository's node_modules so the app ships exactly the versions the lockfile pins and the tests ran
// against. Run `npm ci && npm run build` in the repository root first.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const out = path.join(desktop, 'build', 'app');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

for (const required of ['server/dist/start.js', 'client/dist/index.html']) {
  if (!fs.existsSync(path.join(root, required))) {
    console.error(`Нет ${required}: сначала соберите проект командой "npm run build" в корне репозитория.`);
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });

copy('server/dist', 'server/dist');
copy('client/dist', 'client/dist');
copy('.env.example', 'env.example');
fs.cpSync(path.join(desktop, 'src'), out, { recursive: true });
fs.cpSync(path.join(desktop, 'resources', 'icon.png'), path.join(out, 'icon.png'));
fs.writeFileSync(path.join(out, 'server', 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

const rootPkg = readJson(path.join(root, 'package.json'));
const serverPkg = readJson(path.join(root, 'server', 'package.json'));
const dependencies = {};
for (const name of Object.keys(serverPkg.dependencies)) {
  dependencies[name] = readJson(path.join(root, 'node_modules', name, 'package.json')).version;
}

// Every package the server needs at run time, as npm installed it from the lockfile.
const ls = spawnSync('npm', ['ls', '--omit=dev', '--all', '--parseable', '--workspace', 'server'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const rootModules = path.join(root, 'node_modules');
const packages = ls.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith(rootModules + path.sep))
  .map((line) => path.relative(rootModules, line))
  // Nested node_modules folders come along with their parent package.
  .filter((rel) => !rel.includes(`${path.sep}node_modules${path.sep}`))
  // The server workspace itself is linked into node_modules; its code is already in server/dist.
  .filter((rel) => !rel.startsWith(`@soundfy${path.sep}`));
for (const name of Object.keys(dependencies)) {
  if (!packages.includes(path.normalize(name))) {
    console.error(`npm ls не нашёл зависимость ${name}: выполните "npm ci" в корне репозитория.\n${ls.stderr}`);
    process.exit(1);
  }
}
for (const rel of packages) {
  fs.cpSync(path.join(rootModules, rel), path.join(out, 'node_modules', rel), { recursive: true, dereference: true });
}
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'soundfy',
      productName: 'MixOn',
      version: rootPkg.version,
      description: 'Музыкальная платформа в духе SoundCloud с синхронизацией новых релизов',
      author: { name: 'MixOn', url: 'https://github.com/qwixxys/MixOn' },
      homepage: 'https://github.com/qwixxys/MixOn',
      repository: 'https://github.com/qwixxys/MixOn',
      // Lets Linux desktops link the running window to the installed launcher.
      desktopName: 'soundfy.desktop',
      type: 'module',
      main: 'main.mjs',
      dependencies,
    },
    null,
    2,
  ),
);

console.log(`Готово: ${path.relative(root, out)} (${packages.length} пакетов)`);
