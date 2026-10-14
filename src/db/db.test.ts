import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { linesFromText } from '../parser/lines';
import { parseScript } from '../parser/parse';
import {
  closeDb, deleteAllData, deleteScript, exportBackup, getPrefs, getScript, getSettings,
  importBackup, listScripts, savePrefs, saveScript, saveSettings,
} from './db';

// Dialogo originale scritto per i test.
const sample = (id: string, now = 1) =>
  parseScript(linesFromText('ARIA: Piove.\nTOMMASO: Ho l’ombrello.\nARIA: Meno male.\nTOMMASO: Andiamo.'), {
    fileName: `${id}.pdf`,
    id,
    now,
  });

afterEach(async () => {
  await deleteAllData();
  await closeDb();
});

describe('salvataggio locale', () => {
  it('salva e rilegge un copione', async () => {
    await saveScript(sample('a'));
    const s = await getScript('a');
    expect(s?.characters.map((c) => c.name)).toEqual(['ARIA', 'TOMMASO']);
    expect(s?.blocks).toHaveLength(4);
  });

  it('conserva ruolo, posizione e voci per ciascun copione', async () => {
    await saveScript(sample('a'));
    const st = await getSettings('a');
    expect(st.role).toBeNull();
    await saveSettings({ ...st, role: 'p1', position: 3, voices: { p2: { voiceURI: 'v', rate: 1.1, pitch: 0.9 } } });
    const again = await getSettings('a');
    expect(again.role).toBe('p1');
    expect(again.position).toBe(3);
    expect(again.voices.p2?.rate).toBe(1.1);
    expect((await listScripts())[0]?.role).toBe('ARIA');
  });

  it('elenca i copioni dal più recente', async () => {
    await saveScript(sample('vecchio', 1));
    await saveScript(sample('nuovo', 2));
    expect((await listScripts()).map((s) => s.id)).toEqual(['nuovo', 'vecchio']);
  });

  it('salva le preferenze con la privacy rigorosa attiva per impostazione predefinita', async () => {
    expect((await getPrefs()).strictPrivacy).toBe(true);
    await savePrefs({ strictPrivacy: false, voiceGenders: {} });
    expect((await getPrefs()).strictPrivacy).toBe(false);
  });
});

describe('eliminazione dati', () => {
  it('elimina il copione insieme alle sue impostazioni', async () => {
    await saveScript(sample('a'));
    await saveScript(sample('b'));
    await saveSettings({ ...(await getSettings('a')), role: 'p1' });
    await deleteScript('a');
    expect(await getScript('a')).toBeUndefined();
    expect((await getSettings('a')).role).toBeNull();
    expect((await listScripts()).map((s) => s.id)).toEqual(['b']);
  });

  it('cancella tutti i dati', async () => {
    await saveScript(sample('a'));
    await savePrefs({ strictPrivacy: false, voiceGenders: {} });
    await deleteAllData();
    expect(await listScripts()).toEqual([]);
    expect((await getPrefs()).strictPrivacy).toBe(true);
  });
});

describe('backup', () => {
  it('esporta e reimporta copioni e impostazioni', async () => {
    await saveScript(sample('a'));
    await saveSettings({ ...(await getSettings('a')), role: 'p2', position: 2 });
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    await deleteAllData();
    expect(await importBackup(backup)).toBe(1);
    expect((await getScript('a'))?.title).toBe('a');
    expect((await getSettings('a')).role).toBe('p2');
  });

  it('rifiuta file non validi senza modificare i dati', async () => {
    await saveScript(sample('a'));
    await expect(importBackup({ foo: 1 })).rejects.toThrow(/backup valido/);
    await expect(
      importBackup({ app: 'si-va-in-scena', version: 1, scripts: [{ id: 'x' }], settings: [] }),
    ).rejects.toThrow(/non validi/);
    expect((await listScripts()).map((s) => s.id)).toEqual(['a']);
  });
});
