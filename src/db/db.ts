import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_PREFS, defaultSettings, type GlobalPrefs, type Script, type ScriptSettings } from '../types';

interface Schema extends DBSchema {
  scripts: { key: string; value: Script };
  settings: { key: string; value: ScriptSettings };
  prefs: { key: string; value: GlobalPrefs };
}

const DB_NAME = 'si-va-in-scena';
const PREFS_KEY = 'global';
let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('scripts', { keyPath: 'id' });
      d.createObjectStore('settings', { keyPath: 'scriptId' });
      d.createObjectStore('prefs');
    },
  });
  return dbPromise;
}

/** Chiude la connessione (usato dai test). */
export async function closeDb(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export interface ScriptSummary {
  id: string;
  title: string;
  fileName: string;
  importedAt: number;
  updatedAt: number;
  characterCount: number;
  role: string | null;
}

export async function listScripts(): Promise<ScriptSummary[]> {
  const d = await db();
  const [scripts, settings] = await Promise.all([d.getAll('scripts'), d.getAll('settings')]);
  const roleById = new Map(settings.map((s) => [s.scriptId, s.role]));
  return scripts
    .map((s) => ({
      id: s.id,
      title: s.title,
      fileName: s.fileName,
      importedAt: s.importedAt,
      updatedAt: s.updatedAt,
      characterCount: s.characters.length,
      role: s.characters.find((c) => c.id === roleById.get(s.id))?.name ?? null,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getScript(id: string): Promise<Script | undefined> {
  return (await db()).get('scripts', id);
}

export async function saveScript(script: Script): Promise<void> {
  await (await db()).put('scripts', script);
}

/** Elimina il copione e tutti i dati elaborati a esso collegati. */
export async function deleteScript(id: string): Promise<void> {
  const tx = (await db()).transaction(['scripts', 'settings'], 'readwrite');
  await Promise.all([tx.objectStore('scripts').delete(id), tx.objectStore('settings').delete(id), tx.done]);
}

export async function getSettings(scriptId: string): Promise<ScriptSettings> {
  return (await (await db()).get('settings', scriptId)) ?? defaultSettings(scriptId);
}

export async function saveSettings(settings: ScriptSettings): Promise<void> {
  await (await db()).put('settings', settings);
}

export async function getPrefs(): Promise<GlobalPrefs> {
  return { ...DEFAULT_PREFS, ...(await (await db()).get('prefs', PREFS_KEY)) };
}

export async function savePrefs(prefs: GlobalPrefs): Promise<void> {
  await (await db()).put('prefs', prefs, PREFS_KEY);
}

/** Cancella tutti i dati dell'app dal dispositivo. */
export async function deleteAllData(): Promise<void> {
  const tx = (await db()).transaction(['scripts', 'settings', 'prefs'], 'readwrite');
  await Promise.all([
    tx.objectStore('scripts').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('prefs').clear(),
    tx.done,
  ]);
}

// ---------------------------------------------------------------- backup

export interface Backup {
  app: 'si-va-in-scena';
  version: 1;
  exportedAt: string;
  scripts: Script[];
  settings: ScriptSettings[];
}

export async function exportBackup(): Promise<Backup> {
  const d = await db();
  const [scripts, settings] = await Promise.all([d.getAll('scripts'), d.getAll('settings')]);
  return { app: 'si-va-in-scena', version: 1, exportedAt: new Date().toISOString(), scripts, settings };
}

function isScript(v: unknown): v is Script {
  const s = v as Script;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    Array.isArray(s.characters) &&
    Array.isArray(s.blocks) &&
    s.blocks.every((b) => typeof b?.id === 'string' && typeof b.text === 'string' && Array.isArray(b.speakers))
  );
}

/** Importa un backup; i copioni con lo stesso id vengono sostituiti. Restituisce quanti copioni sono stati importati. */
export async function importBackup(data: unknown): Promise<number> {
  const b = data as Backup;
  if (!b || b.app !== 'si-va-in-scena' || b.version !== 1 || !Array.isArray(b.scripts)) {
    throw new Error('Il file non è un backup valido di SI VA IN SCENA.');
  }
  const scripts = b.scripts.filter(isScript);
  if (scripts.length !== b.scripts.length) throw new Error('Il backup contiene dati non validi.');
  const ids = new Set(scripts.map((s) => s.id));
  const settings = (Array.isArray(b.settings) ? b.settings : []).filter(
    (s) => s && typeof s.scriptId === 'string' && ids.has(s.scriptId),
  );
  const tx = (await db()).transaction(['scripts', 'settings'], 'readwrite');
  await Promise.all([
    ...scripts.map((s) => tx.objectStore('scripts').put(s)),
    ...settings.map((s) => tx.objectStore('settings').put({ ...defaultSettings(s.scriptId), ...s })),
    tx.done,
  ]);
  return scripts.length;
}

/** Chiede al browser di non cancellare automaticamente i dati locali. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
