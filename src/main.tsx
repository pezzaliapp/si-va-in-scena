import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { setRegistration, updateReady, watchForUpdates } from './update';
import './styles.css';

// La nuova versione si scarica in background e si attiva al primo momento
// sicuro (vedi update.ts): mai nel mezzo di una prova o di un'importazione.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => updateReady(() => void updateSW(true)),
  onRegisteredSW: (_url, registration) => setRegistration(registration),
});
watchForUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
