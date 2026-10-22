// soundFy desktop: runs the soundFy server inside Electron and shows its web interface in a window.
// Data (database, uploads, keys) lives in the user's profile, e.g. %APPDATA%\soundFy on Windows.
import { app, BrowserWindow, clipboard, dialog, Menu, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** A fixed port keeps the address the phone app remembers, and logins, the same between launches. */
const DEFAULT_PORT = 4777;
/** Login pages that must open inside the window so the service can redirect back to soundFy. */
const OAUTH_HOSTS = new Set(['secure.soundcloud.com', 'soundcloud.com', 'api.soundcloud.com']);
const REPO_URL = 'https://github.com/qwixxys/soundFy';

const userData = app.getPath('userData');
const dataDir = path.join(userData, 'data');
const settingsFile = path.join(userData, 'settings.json');
const envFile = path.join(userData, 'soundfy.env');

let settings = { lanAccess: false };
let running = null;
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

async function startServer() {
  // Keys for Genius, SoundCloud and the rest, in the same format as the server's .env.
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const host = settings.lanAccess ? '0.0.0.0' : '127.0.0.1';
  const port = (await portIsFree(DEFAULT_PORT, host)) ? DEFAULT_PORT : 0;
  Object.assign(process.env, { DATA_DIR: dataDir, HOST: host, PORT: String(port), NODE_ENV: 'production' });
  const { startServer: start } = await import(pathToFileURL(path.join(here, 'server', 'dist', 'start.js')).href);
  return start();
}

function createWindow(url) {
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'soundFy',
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
  window.webContents.on('will-navigate', (event, target) => {
    const next = new URL(target);
    if (next.origin === origin || OAUTH_HOSTS.has(next.hostname)) return;
    event.preventDefault();
    if (isWebUrl(target)) shell.openExternal(target);
  });
  window.loadURL(url);
}

async function restart() {
  await running?.close();
  running = null;
  app.relaunch();
  app.exit(0);
}

async function setLanAccess(enabled) {
  if (enabled) {
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Доступ из локальной сети',
      message: 'Открыть soundFy для других устройств в вашей сети?',
      detail:
        'Так к soundFy можно подключиться с телефона. Открыть сайт и зарегистрироваться сможет любой, кто подключён к той же сети, ' +
        'поэтому включайте доступ только в домашней сети, которой доверяете. Windows может спросить разрешение для брандмауэра.\n\n' +
        'soundFy перезапустится.',
      buttons: ['Включить', 'Отмена'],
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
      title: 'Подключить телефон',
      message: 'Слушайте свою библиотеку с телефона',
      detail:
        'Установите приложение soundFy для Android и подключите телефон к той же Wi-Fi сети, что и компьютер. ' +
        'Сначала нужно включить доступ из локальной сети.',
      buttons: ['Включить доступ…', 'Закрыть'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await setLanAccess(true);
    return;
  }
  const addresses = lanAddresses().map((ip) => `http://${ip}:${running.port}`);
  const { response } = await dialog.showMessageBox(window, {
    type: 'info',
    title: 'Подключить телефон',
    message: addresses.length ? addresses.join('\n') : 'Компьютер не подключён к сети',
    detail: addresses.length
      ? 'Откройте приложение soundFy на телефоне, подключённом к той же Wi-Fi сети, и введите этот адрес. ' +
        'Войдите тем же аккаунтом, что и здесь.' +
        (running.port === DEFAULT_PORT ? '' : `\n\nПорт ${DEFAULT_PORT} был занят, поэтому адрес может измениться после перезапуска.`)
      : 'Подключитесь к Wi-Fi или кабельной сети и откройте это окно снова.',
    buttons: addresses.length ? ['Скопировать адрес', 'Закрыть'] : ['Закрыть'],
    defaultId: 0,
    cancelId: addresses.length ? 1 : 0,
  });
  if (addresses.length && response === 0) clipboard.writeText(addresses[0]);
}

async function openEnvFile() {
  if (!fs.existsSync(envFile)) {
    const template = fs.readFileSync(path.join(here, 'env.example'), 'utf8');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(
      envFile,
      '# Ключи сервисов для soundFy. После изменения перезапустите приложение.\n' +
        '# PORT, HOST и DATA_DIR здесь не действуют: их задаёт само приложение.\n\n' +
        template,
    );
  }
  const error = await shell.openPath(envFile);
  if (error) dialog.showErrorBox('Не удалось открыть файл', `${envFile}\n\n${error}`);
}

function showAbout() {
  dialog.showMessageBox(window, {
    type: 'info',
    title: 'О программе',
    message: `soundFy ${app.getVersion()}`,
    detail: `Музыкальная платформа в духе SoundCloud с синхронизацией новых релизов.\n\nДанные: ${dataDir}\n${REPO_URL}`,
    buttons: ['OK'],
  });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'soundFy',
        submenu: [
          { label: 'Подключить телефон…', click: showPhoneDialog },
          { label: 'Доступ из локальной сети', type: 'checkbox', checked: settings.lanAccess, click: (item) => setLanAccess(item.checked) },
          { type: 'separator' },
          { label: 'Ключи сервисов (soundfy.env)…', click: openEnvFile },
          { label: 'Папка с данными', click: () => shell.openPath(dataDir) },
          { type: 'separator' },
          { label: 'Перезапустить', click: restart },
          { role: 'quit', label: 'Выход' },
        ],
      },
      {
        label: 'Правка',
        submenu: [
          { role: 'undo', label: 'Отменить' },
          { role: 'redo', label: 'Повторить' },
          { type: 'separator' },
          { role: 'cut', label: 'Вырезать' },
          { role: 'copy', label: 'Копировать' },
          { role: 'paste', label: 'Вставить' },
          { role: 'selectAll', label: 'Выделить всё' },
        ],
      },
      {
        label: 'Вид',
        submenu: [
          { role: 'reload', label: 'Обновить страницу' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Обычный масштаб' },
          { role: 'zoomIn', label: 'Увеличить' },
          { role: 'zoomOut', label: 'Уменьшить' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Во весь экран' },
          { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        ],
      },
      {
        label: 'Справка',
        submenu: [
          { label: 'soundFy на GitHub', click: () => shell.openExternal(REPO_URL) },
          { label: 'О программе', click: showAbout },
        ],
      },
    ]),
  );
}

async function main() {
  settings = readSettings();
  buildMenu();
  try {
    running = await startServer();
  } catch (err) {
    dialog.showErrorBox('soundFy не запустился', `${err.message}\n\nДанные: ${dataDir}`);
    app.exit(1);
    return;
  }
  createWindow(`http://127.0.0.1:${running.port}`);
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
