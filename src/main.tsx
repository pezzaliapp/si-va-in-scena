import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { setUpdater } from './update';
import './styles.css';

// La nuova versione si installa in background ma si attiva solo su richiesta,
// per non ricaricare la pagina nel mezzo di una prova.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => setUpdater(() => void updateSW(true)),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
