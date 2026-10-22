// Assembles build/app: the built server and client, the Electron entry point and the server's runtime dependencies.
// Run `npm run build` in the repository root first.
import { execSync } from 'node:child_process';
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

// The server's dependencies, pinned to the versions the repository was built and tested with.
const rootPkg = readJson(path.join(root, 'package.json'));
const serverPkg = readJson(path.join(root, 'server', 'package.json'));
const dependencies = {};
for (const name of Object.keys(serverPkg.dependencies)) {
  dependencies[name] = readJson(path.join(root, 'node_modules', name, 'package.json')).version;
}
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'soundfy',
      productName: 'soundFy',
      version: rootPkg.version,
      description: 'Музыкальная платформа в духе SoundCloud с синхронизацией новых релизов',
      author: { name: 'soundFy', url: 'https://github.com/qwixxys/soundFy' },
      homepage: 'https://github.com/qwixxys/soundFy',
      repository: 'https://github.com/qwixxys/soundFy',
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

execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: out, stdio: 'inherit' });
console.log(`Готово: ${path.relative(root, out)}`);
