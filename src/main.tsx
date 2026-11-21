import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { createBrowserServices } from './ui/browserServices';
import { practiceFen } from './ui/gameOptions';

// Service worker: caches the app shell so it loads offline and can be installed (ADR-0001).
registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App services={createBrowserServices()} startFen={practiceFen(window.location.search)} />
  </StrictMode>,
);
