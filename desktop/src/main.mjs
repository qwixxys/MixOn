// MixOn desktop: runs the MixOn server inside Electron and shows its web interface in a window.
// Data (database, uploads, keys) lives in the user's profile, e.g. %APPDATA%\MixOn on Windows.
import { app, BrowserWindow, clipboard, dialog, Menu, nativeTheme, session, shell } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
/** A fixed port keeps the address the phone app remembers, and logins, the same between launches. */
const DEFAULT_PORT = 4777;
/** Service login pages: they open in a separate login window that can follow the service's own sign-in steps. */
const OAUTH_HOSTS = new Set(['secure.soundcloud.com', 'soundcloud.com', 'api.soundcloud.com', 'accounts.spotify.com']);
/** What the MixOn interface itself may use; everything else (camera, microphone, location, clipboard…) is denied. */
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'notifications', 'clipboard-read', 'clipboard-sanitized-write']);
const REPO_URL = 'https://github.com/qwixxys/MixOn';

const userData = app.getPath('userData');
const dataDir = path.join(userData, 'data');
const settingsFile = path.join(userData, 'settings.json');
const envFile = path.join(userData, 'soundfy.env');

let settings = { lanAccess: false };
let running = null;
/** The interface language: what the window last showed, else the system's. */
let lang = 'ru';
let window = null;
let quitting = false;

function readSettings() {
  try {
    return { lanAccess: false, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    return { lanAccess: false };
  }
}

function saveSettings() {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

function portIsFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const isWebUrl = (url) => /^https?:\/\//i.test(url);

/** The app's own texts in English; the window's are translated by the interface itself (client/src/i18n). */
const EN = {
  'Вход': 'Sign in',
  'Доступ из локальной сети': 'Local network access',
  'Открыть MixOn для других устройств в вашей сети?': 'Open MixOn to other devices on your network?',
  'Так к MixOn можно подключиться с телефона. Открыть сайт и зарегистрироваться сможет любой, кто подключён к той же сети, поэтому включайте доступ только в домашней сети, которой доверяете. Windows может спросить разрешение для брандмауэра.\n\nMixOn перезапустится.':
    'This lets you connect to MixOn from your phone. Anyone on the same network will be able to open the site and sign up, so turn access on only on a home network you trust. Windows may ask for a firewall permission.\n\nMixOn will restart.',
  'Включить': 'Turn on',
  'Отмена': 'Cancel',
  'Подключить телефон': 'Connect a phone',
  'Слушайте свою библиотеку с телефона': 'Listen to your library from your phone',
  'Установите приложение MixOn для Android и подключите телефон к той же Wi-Fi сети, что и компьютер. Сначала нужно включить доступ из локальной сети.':
    'Install the MixOn app for Android and connect the phone to the same Wi-Fi network as the computer. Local network access has to be turned on first.',
  'Включить доступ…': 'Turn on access…',
  'Закрыть': 'Close',
  'Компьютер не подключён к сети': 'The computer is not connected to a network',
  'В приложении MixOn на телефоне, подключённом к той же Wi-Fi сети, откройте меню профиля → «Подключиться к серверу» и введите этот адрес. Войдите тем же аккаунтом, что и здесь.':
    'In the MixOn app on a phone connected to the same Wi-Fi network, open the profile menu → “Connect to a server” and enter this address. Sign in with the same account as here.',
  'Порт {0} был занят, поэтому адрес может измениться после перезапуска.': 'Port {0} was taken, so the address may change after a restart.',
  'Подключитесь к Wi-Fi или кабельной сети и откройте это окно снова.': 'Connect to Wi-Fi or a wired network and open this window again.',
  'Скопировать адрес': 'Copy the address',
  '# Ключи сервисов для MixOn. После изменения перезапустите приложение.': '# Service keys for MixOn. Restart the app after changing them.',
  '# PORT, HOST и DATA_DIR здесь не действуют: их задаёт само приложение.': '# PORT, HOST and DATA_DIR have no effect here: the app sets them itself.',
  'Не удалось открыть файл': 'Could not open the file',
  'О программе': 'About',
  'Музыкальная платформа в духе SoundCloud с синхронизацией новых релизов.': 'A music platform in the spirit of SoundCloud that syncs new releases.',
  'Данные: {0}': 'Data: {0}',
  'Подключить телефон…': 'Connect a phone…',
  'Ключи сервисов…': 'Service keys…',
  'Файл настроек (soundfy.env)…': 'Settings file (soundfy.env)…',
  'Папка с данными': 'Data folder',
  'Перезапустить': 'Restart',
  'Выход': 'Quit',
  'Правка': 'Edit',
  'Отменить': 'Undo',
  'Повторить': 'Redo',
  'Вырезать': 'Cut',
  'Копировать': 'Copy',
  'Вставить': 'Paste',
  'Выделить всё': 'Select all',
  'Вид': 'View',
  'Обновить страницу': 'Reload the page',
  'Обычный масштаб': 'Actual size',
  'Увеличить': 'Zoom in',
  'Уменьшить': 'Zoom out',
  'Во весь экран': 'Full screen',
  'Инструменты разработчика': 'Developer tools',
  'Справка': 'Help',
  'MixOn на GitHub': 'MixOn on GitHub',
  'MixOn не запустился': 'MixOn did not start',
};

/** A text in the interface language, with {0}, {1}… filled in. */
const t = (text, ...values) => (lang === 'en' ? (EN[text] ?? text) : text).replace(/\{(\d+)\}/g, (_, i) => String(values[i]));

/** Follows the language chosen in the window («Оформление»): the menu and dialogs switch with it. */
async function followLanguage() {
  const chosen = await window?.webContents.executeJavaScript('document.documentElement.lang').catch(() => null);
  if ((chosen !== 'ru' && chosen !== 'en') || chosen === lang) return;
  lang = settings.lang = chosen;
  saveSettings();
  buildMenu();
}

/**
 * The server reads its settings from the environment once, while starting. They are put there only for that moment,
 * so the keys from soundfy.env neither leak into programs the app opens (browser, editor) nor survive a relaunch.
 */
async function startServer() {
  const host = settings.lanAccess ? '0.0.0.0' : '127.0.0.1';
  const port = (await portIsFree(DEFAULT_PORT, host)) ? DEFAULT_PORT : 0;
  // Keys for Genius, SoundCloud and the rest, in the same format as the server's .env.
  const keys = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  const original = { ...process.env };
  Object.assign(process.env, keys, { DATA_DIR: dataDir, HOST: host, PORT: String(port), NODE_ENV: 'production' });
  try {
    const { startServer: start } = await import(pathToFileURL(path.join(here, 'server', 'dist', 'start.js')).href);
    return await start();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
}

const sameOrigin = (url, origin) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

/**
 * Service sign-in in its own window: it may go through other sites (Google, Apple…) and finishes when the service
 * sends the browser back to MixOn, whose page then opens in the main window.
 */
function openLoginWindow(url, origin) {
  const login = new BrowserWindow({
    parent: window,
    width: 520,
    height: 760,
    title: t('Вход'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: 'login' },
  });
  const finish = (event, target) => {
    if (!sameOrigin(target, origin)) return;
    event.preventDefault();
    login.destroy();
    window?.loadURL(target);
  };
  login.webContents.on('will-navigate', (event, target) => {
    if (!/^https:\/\//i.test(target)) finish(event, target);
  });
  login.webContents.on('will-redirect', finish);
  // Sign-in popups (for example "Continue with Google") stay inside the app.
  login.webContents.setWindowOpenHandler(({ url: target }) => (/^https:\/\//i.test(target) ? { action: 'allow' } : { action: 'deny' }));
  login.loadURL(url);
}

function createWindow(url) {
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'MixOn',
    icon: path.join(here, 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1110' : '#fff8f6',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => (window = null));

  const origin = new URL(url).origin;
  // Links to other sites (Genius, Deezer, the services' pages) open in the system browser.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isWebUrl(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  const leave = (event, target) => {
    // will-redirect also fires inside frames (YouTube's player); only the page itself is kept in the app.
    if (event.isMainFrame === false || sameOrigin(target, origin)) return;
    event.preventDefault();
    if (OAUTH_HOSTS.has(new URL(target).hostname)) openLoginWindow(target, origin);
    else if (isWebUrl(target)) shell.openExternal(target);
  };
  window.webContents.on('will-navigate', leave);
  window.webContents.on('will-redirect', leave);
  window.webContents.on('did-finish-load', followLanguage);
  window.loadURL(url);
}

async function restart() {
  await running?.close();
  running = null;
  // Inside an AppImage the running binary disappears when the app exits, so start the AppImage file again instead.
  if (process.env.APPIMAGE) app.relaunch({ execPath: process.env.APPIMAGE, args: process.argv.slice(1) });
  else app.relaunch();
  app.exit(0);
}

function restrictPermissions(origin) {
  const allowed = (requestingUrl, permission) => sameOrigin(requestingUrl, origin) && ALLOWED_PERMISSIONS.has(permission);
  for (const ses of [session.defaultSession, session.fromPartition('login')]) {
    ses.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(allowed(details.requestingUrl ?? contents.getURL(), permission)),
    );
    ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => allowed(requestingOrigin, permission));
  }
}

async function setLanAccess(enabled) {
  if (enabled) {
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      title: t('Доступ из локальной сети'),
      message: t('Открыть MixOn для других устройств в вашей сети?'),
      detail: t(
        'Так к MixOn можно подключиться с телефона. Открыть сайт и зарегистрироваться сможет любой, кто подключён к той же сети, ' +
          'поэтому включайте доступ только в домашней сети, которой доверяете. Windows может спросить разрешение для брандмауэра.\n\n' +
          'MixOn перезапустится.',
      ),
      buttons: [t('Включить'), t('Отмена')],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return buildMenu();
  }
  settings.lanAccess = enabled;
  saveSettings();
  await restart();
}

async function showPhoneDialog() {
  if (!settings.lanAccess) {
    const { response } = await dialog.showMessageBox(window, {
      type: 'info',
      title: t('Подключить телефон'),
      message: t('Слушайте свою библиотеку с телефона'),
      detail: t(
        'Установите приложение MixOn для Android и подключите телефон к той же Wi-Fi сети, что и компьютер. ' +
          'Сначала нужно включить доступ из локальной сети.',
      ),
      buttons: [t('Включить доступ…'), t('Закрыть')],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await setLanAccess(true);
    return;
  }
  const addresses = lanAddresses().map((ip) => `http://${ip}:${running.port}`);
  const { response } = await dialog.showMessageBox(window, {
    type: 'info',
    title: t('Подключить телефон'),
    message: addresses.length ? addresses.join('\n') : t('Компьютер не подключён к сети'),
    detail: addresses.length
      ? t(
          'В приложении MixOn на телефоне, подключённом к той же Wi-Fi сети, откройте меню профиля → «Подключиться к серверу» ' +
            'и введите этот адрес. Войдите тем же аккаунтом, что и здесь.',
        ) +
        (running.port === DEFAULT_PORT ? '' : `\n\n${t('Порт {0} был занят, поэтому адрес может измениться после перезапуска.', DEFAULT_PORT)}`)
      : t('Подключитесь к Wi-Fi или кабельной сети и откройте это окно снова.'),
    buttons: addresses.length ? [t('Скопировать адрес'), t('Закрыть')] : [t('Закрыть')],
    defaultId: 0,
    cancelId: addresses.length ? 1 : 0,
  });
  if (addresses.length && response === 0) clipboard.writeText(addresses[0]);
}

/** The app's own services page, where each service's card takes its keys. */
function openKeys() {
  if (!window || !running) return;
  window.loadURL(`http://127.0.0.1:${running.port}/sync#keys`);
  window.show();
}

async function openEnvFile() {
  if (!fs.existsSync(envFile)) {
    const template = fs.readFileSync(path.join(here, 'env.example'), 'utf8');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(
      envFile,
      `${t('# Ключи сервисов для MixOn. После изменения перезапустите приложение.')}\n` +
        `${t('# PORT, HOST и DATA_DIR здесь не действуют: их задаёт само приложение.')}\n\n` +
        template,
    );
  }
  const error = await shell.openPath(envFile);
  if (error) dialog.showErrorBox(t('Не удалось открыть файл'), `${envFile}\n\n${error}`);
}

function showAbout() {
  dialog.showMessageBox(window, {
    type: 'info',
    title: t('О программе'),
    message: `MixOn ${app.getVersion()}`,
    detail: `${t('Музыкальная платформа в духе SoundCloud с синхронизацией новых релизов.')}\n\n${t('Данные: {0}', dataDir)}\n${REPO_URL}`,
    buttons: ['OK'],
  });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'MixOn',
        submenu: [
          { label: t('Подключить телефон…'), click: showPhoneDialog },
          { label: t('Доступ из локальной сети'), type: 'checkbox', checked: settings.lanAccess, click: (item) => setLanAccess(item.checked) },
          { type: 'separator' },
          { label: t('Ключи сервисов…'), click: openKeys },
          { label: t('Файл настроек (soundfy.env)…'), click: openEnvFile },
          { label: t('Папка с данными'), click: () => shell.openPath(dataDir) },
          { type: 'separator' },
          { label: t('Перезапустить'), click: restart },
          { role: 'quit', label: t('Выход') },
        ],
      },
      {
        label: t('Правка'),
        submenu: [
          { role: 'undo', label: t('Отменить') },
          { role: 'redo', label: t('Повторить') },
          { type: 'separator' },
          { role: 'cut', label: t('Вырезать') },
          { role: 'copy', label: t('Копировать') },
          { role: 'paste', label: t('Вставить') },
          { role: 'selectAll', label: t('Выделить всё') },
        ],
      },
      {
        label: t('Вид'),
        submenu: [
          { role: 'reload', label: t('Обновить страницу') },
          { type: 'separator' },
          { role: 'resetZoom', label: t('Обычный масштаб') },
          { role: 'zoomIn', label: t('Увеличить') },
          { role: 'zoomOut', label: t('Уменьшить') },
          { type: 'separator' },
          { role: 'togglefullscreen', label: t('Во весь экран') },
          { role: 'toggleDevTools', label: t('Инструменты разработчика') },
        ],
      },
      {
        label: t('Справка'),
        submenu: [
          { label: t('MixOn на GitHub'), click: () => shell.openExternal(REPO_URL) },
          { label: t('О программе'), click: showAbout },
        ],
      },
    ]),
  );
}

async function main() {
  settings = readSettings();
  lang = settings.lang ?? (/^(ru|uk|be|kk)\b/i.test(app.getLocale()) ? 'ru' : 'en');
  buildMenu();
  try {
    running = await startServer();
  } catch (err) {
    dialog.showErrorBox(t('MixOn не запустился'), `${err.message}\n\n${t('Данные: {0}', dataDir)}`);
    app.exit(1);
    return;
  }
  const url = `http://127.0.0.1:${running.port}`;
  restrictPermissions(new URL(url).origin);
  createWindow(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.soundfy.desktop');
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  // Let the server finish open requests and close the database before the process exits.
  app.on('before-quit', (event) => {
    if (!running || quitting) return;
    event.preventDefault();
    quitting = true;
    running.close().finally(() => app.quit());
  });
  app.whenReady().then(main);
}
