// Collega l'aggiornamento del service worker all'interfaccia.
type Listener = (apply: (() => void) | null) => void;

let pending: (() => void) | null = null;
const listeners = new Set<Listener>();

export function setUpdater(apply: () => void): void {
  pending = apply;
  listeners.forEach((l) => l(pending));
}

export function onUpdate(listener: Listener): () => void {
  listeners.add(listener);
  listener(pending);
  return () => listeners.delete(listener);
}
