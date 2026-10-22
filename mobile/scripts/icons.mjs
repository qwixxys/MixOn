// Renders the soundFy logo into every icon the apps need: the desktop icon and the Android launcher icons and splash
// screens. Run with `npm run icons` after changing the logo; the generated images are committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(mobile, '..');
const res = path.join(mobile, 'android', 'app', 'src', 'main', 'res');

const ORANGE = '#ff5500';
// The waveform bars of client/public/favicon.svg, in a 64×64 box.
const BARS = '<g fill="#fff"><rect x="12" y="28" width="5" height="12" rx="2.5"/><rect x="20" y="20" width="5" height="28" rx="2.5"/><rect x="28" y="14" width="5" height="40" rx="2.5"/><rect x="36" y="22" width="5" height="24" rx="2.5"/><rect x="44" y="26" width="5" height="16" rx="2.5"/></g>';

/** Rounded square or circle with the bars, filling the whole image. */
const badge = (shape) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${
    shape === 'circle' ? `<circle cx="32" cy="32" r="32" fill="${ORANGE}"/>` : `<rect width="64" height="64" rx="14" fill="${ORANGE}"/>`
  }${BARS}</svg>`;

/** Bars only, scaled into the middle of an adaptive icon's 108dp canvas (the outer part can be masked away). */
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -22 108 108">${BARS}</svg>`;

const render = (svg, size) => sharp(Buffer.from(svg), { density: 72 * Math.ceil(size / 64) }).resize(size, size).png().toBuffer();

async function write(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
}

// Desktop (electron-builder turns it into .ico for Windows).
await write(path.join(root, 'desktop', 'resources', 'icon.png'), await render(badge('square'), 1024));

// Android launcher icons.
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, scale] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${name}`);
  await write(path.join(dir, 'ic_launcher.png'), await render(badge('square'), 48 * scale));
  await write(path.join(dir, 'ic_launcher_round.png'), await render(badge('circle'), 48 * scale));
  await write(path.join(dir, 'ic_launcher_foreground.png'), await render(foreground, 108 * scale));
}
fs.writeFileSync(
  path.join(res, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ORANGE.toUpperCase()}</color>\n</resources>\n`,
);

// Splash screens: the logo in the middle of an orange screen, at the sizes Capacitor's template uses.
for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const file = path.join(res, dir, 'splash.png');
  if (!fs.existsSync(file)) continue;
  const { width, height } = await sharp(file).metadata();
  const logo = await render(badge('square'), Math.round(Math.min(width, height) * 0.4));
  const splash = await sharp({ create: { width, height, channels: 4, background: ORANGE } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
  await write(file, splash);
}

console.log('Иконки обновлены');
