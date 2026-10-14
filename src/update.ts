// Aggiornamento dell'app tramite il service worker esistente (vite-plugin-pwa).
// La nuova versione viene scaricata in background; si applica (attivazione e
// un solo ricaricamento) al primo momento sicuro: mai durante una prova o
// un'importazione. Copioni e impostazioni restano in IndexedDB e non vengono toccati.

/** Attività che non vanno interrotte da un ricaricamento. */
export type Busy = 'prova' | 'importazione';

export interface UpdateState {
  /** Una nuova versione è scaricata e pronta. */
  available: boolean;
  /** L'utente ha chiesto di aggiornare: si attende la fine di questa attività. */
  waitingFor: Busy | null;
}

export interface ApplyContext {
  available: boolean;
  busy: boolean;
  online: boolean;
  /** L'utente ha premuto «Aggiorna ora». */
  requested: boolean;
  /** L'app è in secondo piano. */
  hidden: boolean;
  /** È visibile l'elenco dei copioni. */
  library: boolean;
  /** C'è già stato un ricaricamento per aggiornamento da poco (protezione dai loop). */
  recentlyReloaded: boolean;
}

/** Regola del momento sicuro. */
export function shouldApply(c: ApplyContext): boolean {
  if (!c.available || c.busy || !c.online) return false;
  if (c.requested) return true;
  if (c.recentlyReloaded) return false;
  return c.hidden || c.library;
}

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const RELOAD_GUARD_MS = 60 * 1000;
const RELOAD_KEY = 'si-va-in-scena:aggiornamento';

let apply: (() => void) | null = null;
let registration: ServiceWorkerRegistration | undefined;
let requested = false;
let applying = false;
let library = true;
let lastCheck = Date.now();
const busy = new Set<Busy>();
const listeners = new Set<() => void>();
let state: UpdateState = { available: false, waitingFor: null };

function recentlyReloaded(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < RELOAD_GUARD_MS;
  } catch {
    return false;
  }
}

function publish() {
  const waitingFor = requested ? ([...busy][0] ?? null) : null;
  if (state.available !== !!apply || state.waitingFor !== waitingFor) {
    state = { available: !!apply, waitingFor };
    listeners.forEach((l) => l());
  }
}

function evaluate() {
  publish();
  if (applying || !apply) return;
  const ok = shouldApply({
    available: true,
    busy: busy.size > 0,
    online: navigator.onLine,
    requested,
    hidden: document.visibilityState === 'hidden',
    library,
    recentlyReloaded: recentlyReloaded(),
  });
  if (!ok) return;
  applying = true;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // senza sessionStorage resta la protezione di `applying`
  }
  apply();
}

/** Da registerSW: una nuova versione è pronta; `fn` la attiva e ricarica la pagina una volta. */
export function updateReady(fn: () => void): void {
  apply = fn;
  evaluate();
}

export function setRegistration(r: ServiceWorkerRegistration | undefined): void {
  registration = r;
}

/** Controlla la presenza di una nuova versione all'apertura e al ritorno in primo piano (non più di ogni 10 minuti). */
export function watchForUpdates(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - lastCheck > CHECK_INTERVAL_MS) {
      lastCheck = Date.now();
      void registration?.update().catch(() => {});
    }
    evaluate();
  });
  window.addEventListener('online', evaluate);
}

/** Segnala l'inizio o la fine di un'attività da non interrompere. */
export function setBusy(what: Busy, on: boolean): void {
  if (on) busy.add(what);
  else busy.delete(what);
  evaluate();
}

/** Indica se è visibile l'elenco dei copioni. */
export function setLibraryVisible(visible: boolean): void {
  library = visible;
  evaluate();
}

/** «Aggiorna ora»: subito, oppure appena termina la prova o l'importazione in corso. */
export function requestUpdate(): void {
  requested = true;
  evaluate();
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateState(): UpdateState {
  return state;
}
