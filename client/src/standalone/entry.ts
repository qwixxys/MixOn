// Entry point of the standalone build: starts the in-page server, then the usual app.
import { inAndroidApp } from '../lib/androidApp';
import { boot } from './boot';

/** Set by connect.html while the listener uses a MixOn server instead of the phone. */
function usesServer() {
  try {
    return JSON.parse(localStorage.getItem('soundfy.mode') ?? 'null') === 'server';
  } catch {
    return false;
  }
}

// "?change" comes from a server's page asking to pick another server (older servers send the app here for that).
if (inAndroidApp && (usesServer() || new URLSearchParams(location.search).has('change'))) {
  location.replace(`/connect.html${location.search}`);
} else {
  try {
    await boot();
    await import('../main');
  } catch (err) {
    console.error(err);
    const root = document.getElementById('root')!;
    root.innerHTML = '<div style="padding:32px 16px;font-family:Roboto,system-ui,sans-serif"><h2>MixOn не запустился</h2><p></p></div>';
    root.querySelector('p')!.textContent = err instanceof Error ? err.message : String(err);
  }
}
