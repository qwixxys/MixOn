/** True inside the soundFy Android app, whose WebView adds "soundFyApp/<version>" to the user agent. */
export const inAndroidApp = typeof navigator !== 'undefined' && /\bsoundFyApp\//.test(navigator.userAgent);

/** Opens the app's own start screen (bundled in the APK, served at http://localhost) to pick another server. */
export function changeServer() {
  location.assign('http://localhost/?change=1');
}
