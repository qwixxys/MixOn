import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { App } from './App';
// In the Android app: the playing track in the notification shade.
import './lib/mediaNotification';
import './styles.css';
// Applies the saved Material 3 colour scheme before the first render.
import './theme/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
