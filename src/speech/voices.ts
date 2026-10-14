import type { Character, GlobalPrefs, ScriptSettings, VoiceGender, VoiceSetting } from '../types';

/** Dati essenziali di una voce di sistema (indipendenti dall'oggetto del browser). */
export interface VoiceInfo {
  uri: string;
  name: string;
  lang: string;
  /** Dichiarata dal browser come elaborata sul dispositivo. */
  local: boolean;
}

/** Lingua preferita per le voci: quella del dispositivo. */
export function appLang(): string {
  return (typeof navigator !== 'undefined' && navigator.language) || 'it-IT';
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function toInfo(v: SpeechSynthesisVoice): VoiceInfo {
  return { uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService };
}

/** Parte dell'interfaccia del browser usata per attendere l'elenco delle voci. */
export interface VoiceSource {
  getVoices(): SpeechSynthesisVoice[];
  addEventListener(type: 'voiceschanged', fn: () => void): void;
  removeEventListener(type: 'voiceschanged', fn: () => void): void;
}

/** Nessun nuovo evento `voiceschanged` per questo tempo: l'elenco è considerato completo. */
export const VOICES_QUIET_MS = 800;

/**
 * Elenco completo delle voci. Chrome le annuncia a più riprese (su macOS prima
 * una ventina con la sola Alice in italiano, poi tutte): si attende che
 * l'elenco smetta di cambiare, al massimo `timeoutMs`.
 */
export function loadVoices(
  source: VoiceSource | undefined = speechSupported() ? window.speechSynthesis : undefined,
  quietMs = VOICES_QUIET_MS,
  timeoutMs = 4000,
): Promise<SpeechSynthesisVoice[]> {
  if (!source) return Promise.resolve([]);
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(quiet);
      clearTimeout(limit);
      source.removeEventListener('voiceschanged', changed);
      resolve(source.getVoices());
    };
    const changed = () => {
      clearTimeout(quiet);
      if (source.getVoices().length > 0) quiet = setTimeout(finish, quietMs);
    };
    const limit = setTimeout(finish, timeoutMs);
    source.addEventListener('voiceschanged', changed);
    changed();
  });
}

/**
 * Nome della voce senza le aggiunte del browser, uguale tra browser diversi:
 * "Eddy (italiano (Italia))" (Chrome) e "Eddy" (Safari) → "eddy";
 * "Microsoft Elsa - Italian (Italy)" → "elsa".
 */
export function baseVoiceName(name: string): string {
  return name
    .replace(/\s*\(.*$/, '')
    .replace(/\s+-\s.*$/, '')
    .replace(/^Microsoft\s+/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Voce salvata nell'elenco attuale: per identificatore, altrimenti per nome
 * (l'identificatore cambia da un browser all'altro). Mai per posizione.
 */
export function findVoice(setting: VoiceSetting | undefined, voices: VoiceInfo[]): VoiceInfo | undefined {
  if (!setting?.voiceURI) return undefined;
  const byUri = voices.find((v) => v.uri === setting.voiceURI);
  if (byUri || !setting.voiceName) return byUri;
  const base = baseVoiceName(setting.voiceName);
  const lang = setting.voiceLang?.slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.name === setting.voiceName) ??
    voices.find((v) => baseVoiceName(v.name) === base && (!lang || v.lang.toLowerCase().startsWith(lang)))
  );
}

/**
 * Suggerimento iniziale, non una classificazione certa: genere presunto di
 * alcune voci di sistema italiane in base al nome del personaggio vocale del
 * produttore (Apple, Microsoft). Il browser non fornisce il genere: l'attore
 * lo corregge o lo indica dopo l'ascolto, e la sua indicazione prevale sempre.
 */
const KNOWN_GENDERS: Record<string, VoiceGender> = {
  alice: 'f',
  federica: 'f',
  paola: 'f',
  luca: 'm',
  eddy: 'm',
  flo: 'f',
  grandma: 'f',
  grandpa: 'm',
  reed: 'm',
  rocko: 'm',
  sandy: 'f',
  shelley: 'f',
  elsa: 'f',
  cosimo: 'm',
};

/** Genere di una voce: indicato dall'attore, altrimenti suggerito dal nome della voce italiana. */
export function voiceGender(
  v: VoiceInfo,
  user: Record<string, VoiceGender>,
): { gender: VoiceGender; source: 'user' | 'known' } | null {
  if (user[v.uri]) return { gender: user[v.uri]!, source: 'user' };
  const known = v.lang.toLowerCase().startsWith('it') ? KNOWN_GENDERS[baseVoiceName(v.name)] : undefined;
  return known ? { gender: known, source: 'known' } : null;
}

/** In privacy rigorosa restano solo le voci locali. */
export function usableVoices(voices: VoiceInfo[], strict: boolean): VoiceInfo[] {
  return strict ? voices.filter((v) => v.local) : voices;
}

/** Ordina le voci mettendo prima quelle nella lingua indicata. */
export function sortVoices(voices: VoiceInfo[], lang: string): VoiceInfo[] {
  const prefix = lang.slice(0, 2).toLowerCase();
  const score = (v: VoiceInfo) => (v.lang.toLowerCase().startsWith(prefix) ? 0 : 1);
  return [...voices].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

const PITCH_VARIANTS = [1, 0.85, 1.15, 0.92, 1.08, 0.78, 1.22];

/** Voce effettiva di un personaggio. */
export interface Assignment {
  voiceURI: string | null;
  rate: number;
  pitch: number;
  /**
   * manual: scelta dall'attore; auto: proposta automatica; missing: la voce
   * scelta non c'è su questo dispositivo (al suo posto una proposta automatica).
   */
  source: 'manual' | 'auto' | 'missing';
  /** Voce desiderata indicata ma genere della voce non confermato dall'attore. */
  unverified: boolean;
}

export interface AssignmentResult {
  byId: Record<string, Assignment>;
  /** Voci della lingua del copione utilizzabili (o tutte, se nessuna è in quella lingua). */
  pool: VoiceInfo[];
  /** Alcune voci sono riutilizzate da più personaggi. */
  shared: boolean;
}

/**
 * Voci per i personaggi (escluso l'attore). Le scelte dell'attore restano
 * invariate; agli altri si propone una voce diversa ciascuno, nella lingua del
 * copione, cominciando dai personaggi per cui è indicata una voce maschile o
 * femminile, poi da quelli con più battute. Il genere conta solo se attendibile:
 * voce desiderata indicata dall'attore per il personaggio, e genere della voce
 * indicato dall'attore o noto dal nome della voce (`voiceGender`). Una voce di genere opposto non viene mai proposta se ce
 * n'è un'altra; se le voci non bastano si riusano variando l'intonazione.
 */
export function assignVoices(input: {
  characters: Character[];
  role: string | null;
  settings: Record<string, VoiceSetting>;
  voices: VoiceInfo[];
  lang: string;
  genders: Record<string, VoiceGender>;
  counts: Map<string, number>;
}): AssignmentResult {
  const { characters, role, settings, voices, lang, genders, counts } = input;
  const prefix = lang.slice(0, 2).toLowerCase();
  const sameLang = sortVoices(voices, lang).filter((v) => v.lang.toLowerCase().startsWith(prefix));
  const pool = sameLang.length > 0 ? sameLang : sortVoices(voices, lang);
  const gender = new Map(voices.map((v) => [v.uri, voiceGender(v, genders)?.gender]));
  const uses = new Map<string, number>();
  const take = (uri: string) => uses.set(uri, (uses.get(uri) ?? 0) + 1);
  const byId: Record<string, Assignment> = {};
  const others = characters
    .filter((c) => c.id !== role)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));

  for (const c of others) {
    const s = settings[c.id];
    const found = findVoice(s, voices);
    if (s && found) {
      take(found.uri);
      byId[c.id] = {
        voiceURI: found.uri,
        rate: s.rate,
        pitch: s.pitch,
        source: 'manual',
        unverified: !!c.voice && gender.get(found.uri) !== c.voice,
      };
    }
  }
  let shared = false;
  const gendered = [...others].sort((a, b) => (a.voice ? 0 : 1) - (b.voice ? 0 : 1));
  for (const c of gendered) {
    if (byId[c.id]) continue;
    const s = settings[c.id];
    // Voce scelta mancante su questo dispositivo: se ne cerca una dello stesso genere.
    const want = c.voice ?? (s?.voiceName ? KNOWN_GENDERS[baseVoiceName(s.voiceName)] : undefined);
    // Ordine di preferenza: genere confermato, poi non classificata, mai il genere opposto se evitabile.
    const rank = (v: VoiceInfo) => {
      const g = gender.get(v.uri);
      // Senza preferenza si lasciano libere, se possibile, le voci già classificate.
      return want ? (g === want ? 0 : g === undefined ? 1 : 2) : g === undefined ? 0 : 1;
    };
    const best = [...pool].sort((a, b) => rank(a) - rank(b) || (uses.get(a.uri) ?? 0) - (uses.get(b.uri) ?? 0))[0];
    const n = best ? (uses.get(best.uri) ?? 0) : 0;
    if (n > 0) shared = true;
    if (best) take(best.uri);
    byId[c.id] = {
      voiceURI: best?.uri ?? null,
      rate: s?.rate ?? 1,
      pitch: s && s.pitch !== 1 ? s.pitch : PITCH_VARIANTS[n % PITCH_VARIANTS.length]!,
      source: s?.voiceURI ? 'missing' : 'auto',
      unverified: !!c.voice && (!best || gender.get(best.uri) !== c.voice),
    };
  }
  return { byId, pool, shared };
}

/** Voci dei personaggi di un copione con le preferenze dell'attore: la stessa per Verifica, Voci e Prova. */
export function scriptVoices(
  characters: Character[],
  settings: Pick<ScriptSettings, 'role' | 'voices'>,
  voices: VoiceInfo[],
  prefs: GlobalPrefs,
  counts: Map<string, number>,
): AssignmentResult {
  return assignVoices({
    characters,
    role: settings.role,
    settings: settings.voices,
    voices: usableVoices(voices, prefs.strictPrivacy),
    lang: appLang(),
    genders: prefs.voiceGenders,
    counts,
  });
}

/**
 * Sceglie la voce effettiva per una battuta. In privacy rigorosa una voce
 * non locale (o la voce predefinita, di cui non si conosce la natura)
 * viene sostituita con la prima voce locale disponibile.
 */
export function resolveVoice(
  setting: VoiceSetting | undefined,
  voices: VoiceInfo[],
  strict: boolean,
  lang: string,
): { voiceURI: string | null; rate: number; pitch: number } | null {
  const rate = setting?.rate ?? 1;
  const pitch = setting?.pitch ?? 1;
  const chosen = findVoice(setting, voices);
  if (chosen && (!strict || chosen.local)) return { voiceURI: chosen.uri, rate, pitch };
  const fallback = sortVoices(usableVoices(voices, strict), lang)[0];
  if (fallback) return { voiceURI: fallback.uri, rate, pitch };
  return strict ? null : { voiceURI: null, rate, pitch };
}
