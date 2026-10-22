import { beforeLeave, STANDALONE } from './standalone';

/** True inside the soundFy Android app, whose WebView adds "soundFyApp/<version>" to the user agent. */
export const inAndroidApp = typeof navigator !== 'undefined' && /\bsoundFyApp\//.test(navigator.userAgent);

/** Opens the app's page for connecting to a server, which is bundled in the APK and served at http://localhost. */
export async function changeServer() {
  await beforeLeave();
  const page = '/connect.html?change=1';
  location.assign(STANDALONE ? page : `http://localhost${page}`);
}
