import type { Character, VoiceSetting } from '../types';

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

/** Le voci vengono caricate in modo asincrono da alcuni browser (Chrome, Safari). */
export function loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    synth.addEventListener('voiceschanged', done);
  });
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

const PITCH_VARIANTS = [1, 0.8, 1.2, 0.9, 1.1, 0.7, 1.3];

/**
 * Assegna automaticamente voci diverse ai personaggi (escluso l'attore).
 * Se le voci non bastano, le riusa variando l'intonazione: lo segnala `shared`.
 */
export function autoAssign(
  characters: Character[],
  role: string | null,
  voices: VoiceInfo[],
  lang: string,
): { voices: Record<string, VoiceSetting>; shared: boolean } {
  const prefix = lang.slice(0, 2).toLowerCase();
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  const pool = sameLang.length > 0 ? sameLang : voices;
  const others = characters.filter((c) => c.id !== role);
  const result: Record<string, VoiceSetting> = {};
  others.forEach((c, i) => {
    const voice = pool.length > 0 ? pool[i % pool.length]! : null;
    const round = pool.length > 0 ? Math.floor(i / pool.length) : 0;
    result[c.id] = {
      voiceURI: voice?.uri ?? null,
      rate: 1,
      pitch: PITCH_VARIANTS[round % PITCH_VARIANTS.length]!,
    };
  });
  return { voices: result, shared: others.length > pool.length };
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
  const chosen = voices.find((v) => v.uri === setting?.voiceURI);
  if (chosen && (!strict || chosen.local)) return { voiceURI: chosen.uri, rate, pitch };
  const fallback = sortVoices(usableVoices(voices, strict), lang)[0];
  if (fallback) return { voiceURI: fallback.uri, rate, pitch };
  return strict ? null : { voiceURI: null, rate, pitch };
}
