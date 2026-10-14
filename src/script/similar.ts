// Suggerimenti di unione per nomi di personaggi probabilmente errati (errori di
// battitura o di riconoscimento del testo, es. una L letta come I). Regole
// generali, nessun nome predefinito; solo proposte: l'unione la decide l'attore.
import { lineCounts, mergeCharacters } from './edit';
import type { Script } from '../types';

export interface MergeSuggestion {
  /** Personaggio sospetto. */
  fromId: string;
  /** Personaggi a cui potrebbe corrispondere, ugualmente vicini. */
  intoIds: string[];
}

/** Il personaggio proposto deve avere almeno tante battute… */
const TARGET_MIN = 3;
/** …e almeno tante volte le battute del nome sospetto. */
const TARGET_RATIO = 4;

/** Lettere maiuscole senza accenti né punteggiatura ("Wai.ter" → "WAITER"). */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}]/gu, '');
}

/** Distanza di modifica (inserimento, cancellazione, sostituzione, scambio di lettere adiacenti). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** Differenza massima ammessa: 1 lettera per nomi brevi, 2 da cinque lettere in su. */
function maxDistance(a: string, b: string): number {
  return Math.max(a.length, b.length) >= 5 ? 2 : 1;
}

/**
 * Nomi con molte meno battute (al più un quarto) di un personaggio dal nome molto simile: stessa
 * iniziale, al massimo 1–2 lettere di differenza (o la stessa grafia a meno di
 * punteggiatura e accenti). In caso di parità si propongono tutti
 * i candidati, senza sceglierne uno.
 */
export function suggestMerges(script: Script, dismissed: readonly string[] = []): MergeSuggestion[] {
  const counts = lineCounts(script);
  const count = (id: string) => counts.get(id) ?? 0;
  const names = new Map(script.characters.map((c) => [c.id, normalizeName(c.name)]));
  const out: MergeSuggestion[] = [];
  for (const c of script.characters) {
    const n = names.get(c.id)!;
    const k = count(c.id);
    if (k === 0 || n.length < 3 || dismissed.includes(c.id)) continue;
    let best = Infinity;
    let intoIds: string[] = [];
    for (const t of script.characters) {
      if (t.id === c.id) continue;
      const m = names.get(t.id)!;
      if (count(t.id) < Math.max(TARGET_MIN, TARGET_RATIO * k) || m[0] !== n[0]) continue;
      const dist = editDistance(n, m);
      if (dist > maxDistance(n, m)) continue;
      if (dist < best) {
        best = dist;
        intoIds = [t.id];
      } else if (dist === best) intoIds.push(t.id);
    }
    if (intoIds.length > 0) out.push({ fromId: c.id, intoIds });
  }
  return out;
}

export interface MergeOutcome<S> {
  settings: S;
  /** Entrambi avevano una voce impostata, diversa: va scelta dall'attore. */
  voiceConflict: boolean;
}

/**
 * Aggiorna le impostazioni dopo l'unione di `fromId` in `intoId`: il ruolo
 * passa al personaggio unito; la voce del personaggio sospetto viene usata
 * solo se l'altro non ne ha una. Se entrambi ne hanno una diversa si tiene
 * quella di `intoId` (o quella scelta con `keep`) e lo si segnala.
 */
export function mergeSettings<
  S extends { role: string | null; voices: Record<string, { voiceURI: string | null; rate: number; pitch: number }> },
>(settings: S, fromId: string, intoId: string, keep: 'into' | 'from' = 'into'): MergeOutcome<S> {
  const { [fromId]: fromVoice, ...voices } = settings.voices;
  const intoVoice = voices[intoId];
  const differ =
    !!fromVoice &&
    !!intoVoice &&
    (fromVoice.voiceURI !== intoVoice.voiceURI || fromVoice.rate !== intoVoice.rate || fromVoice.pitch !== intoVoice.pitch);
  if (fromVoice && (!intoVoice || (differ && keep === 'from'))) voices[intoId] = fromVoice;
  return {
    settings: { ...settings, role: settings.role === fromId ? intoId : settings.role, voices },
    voiceConflict: differ,
  };
}

type VoiceSettings = {
  role: string | null;
  voices: Record<string, { voiceURI: string | null; rate: number; pitch: number }>;
};

export interface BulkPlan<S> {
  /** Unioni applicate dalla conferma collettiva, nell'ordine. */
  merges: { fromId: string; intoId: string }[];
  /** Suggerimenti da decidere singolarmente, con il motivo. */
  individual: (MergeSuggestion & { reason: 'candidati' | 'voci' | 'catena' })[];
  /** Copione e impostazioni dopo le unioni. */
  script: Script;
  settings: S;
}

/**
 * Conferma collettiva: solo i suggerimenti con un unico candidato, in cui il
 * personaggio proposto non è a sua volta sospetto e senza voci scelte diverse
 * da conciliare. Gli altri restano da decidere uno per uno.
 */
export function planBulkMerges<S extends VoiceSettings>(
  script: Script,
  settings: S,
  suggestions: MergeSuggestion[],
): BulkPlan<S> {
  const suspects = new Set(suggestions.map((s) => s.fromId));
  const plan: BulkPlan<S> = { merges: [], individual: [], script, settings };
  for (const sg of suggestions) {
    const intoId = sg.intoIds[0]!;
    const outcome = mergeSettings(plan.settings, sg.fromId, intoId);
    const reason =
      sg.intoIds.length !== 1 ? 'candidati' : suspects.has(intoId) ? 'catena' : outcome.voiceConflict ? 'voci' : null;
    if (reason) {
      plan.individual.push({ ...sg, reason });
      continue;
    }
    plan.merges.push({ fromId: sg.fromId, intoId });
    plan.script = mergeCharacters(plan.script, sg.fromId, intoId);
    plan.settings = outcome.settings;
  }
  return plan;
}
