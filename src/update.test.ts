import { describe, expect, it } from 'vitest';
import { shouldApply, type ApplyContext } from './update';

const base: ApplyContext = {
  available: true,
  busy: false,
  online: true,
  requested: false,
  hidden: false,
  library: false,
  recentlyReloaded: false,
};

describe('momento sicuro per aggiornare', () => {
  it('nessun aggiornamento senza una nuova versione', () => {
    expect(shouldApply({ ...base, available: false, requested: true, library: true })).toBe(false);
  });

  it('automatico sull’elenco dei copioni o con l’app in secondo piano', () => {
    expect(shouldApply({ ...base, library: true })).toBe(true);
    expect(shouldApply({ ...base, hidden: true })).toBe(true);
    expect(shouldApply(base)).toBe(false);
  });

  it('mai durante una prova o un’importazione, neppure su richiesta', () => {
    for (const ctx of [{ library: true }, { hidden: true }, { requested: true }]) {
      expect(shouldApply({ ...base, ...ctx, busy: true })).toBe(false);
    }
  });

  it('«Aggiorna ora» applica subito se non c’è nulla in corso', () => {
    expect(shouldApply({ ...base, requested: true })).toBe(true);
  });

  it('mai senza connessione', () => {
    expect(shouldApply({ ...base, online: false, library: true, requested: true })).toBe(false);
  });

  it('dopo un ricaricamento recente non ricarica di nuovo da solo (niente loop)', () => {
    expect(shouldApply({ ...base, recentlyReloaded: true, library: true, hidden: true })).toBe(false);
    expect(shouldApply({ ...base, recentlyReloaded: true, requested: true })).toBe(true);
  });
});
