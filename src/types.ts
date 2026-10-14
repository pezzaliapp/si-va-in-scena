import type { PacingSettings } from './pacing/pacing';

/** Identificatore speciale per le battute corali ("TUTTI"): include ogni personaggio. */
export const EVERYONE = '*';

/**
 * speech = battuta, direction = didascalia, heading = atto/scena,
 * front = frontespizio (titolo, autore, crediti, note), cast = elenco dei personaggi.
 */
export type BlockKind = 'speech' | 'direction' | 'heading' | 'front' | 'cast';

/** Formato con cui il nome del personaggio introduce la battuta. */
export type CueStyle = 'colon' | 'dash' | 'dot' | 'tab' | 'bold' | 'standalone' | 'space' | 'mixed' | 'mixedTab';

/** Statistiche dell'analisi, senza testo: utili per la diagnostica sul dispositivo. */
export interface ParseStats {
  pages: number;
  lines: number;
  speeches: number;
  formats: Partial<Record<CueStyle, number>>;
  /** Paragrafi senza personaggio segnalati come incerti. */
  unattributed: number;
}

export interface Block {
  id: string;
  kind: BlockKind;
  /** Id dei personaggi che pronunciano la battuta (vuoto per didascalie e intestazioni). */
  speakers: string[];
  text: string;
  /** Indicazione tra parentesi accanto al nome, es. "sottovoce". */
  note?: string;
  offstage?: boolean;
  /** Per le intestazioni: 1 = atto/parte, 2 = scena. */
  level?: 1 | 2;
  simultaneous?: boolean;
  /** Motivo per cui l'attribuzione è incerta e va verificata dall'attore. */
  ambiguous?: string;
  page: number;
}

/** Genere di una voce o della voce desiderata per un personaggio, indicato dall'attore. */
export type VoiceGender = 'm' | 'f';

export interface Character {
  id: string;
  name: string;
  /** Voce desiderata (maschile/femminile), indicata dall'attore; mai dedotta dal nome. */
  voice?: VoiceGender;
}

export interface Script {
  id: string;
  title: string;
  fileName: string;
  importedAt: number;
  updatedAt: number;
  characters: Character[];
  blocks: Block[];
  warnings: string[];
  stats?: ParseStats;
  /** Personaggi per cui l'attore ha rifiutato il suggerimento di unione. */
  dismissedMerges?: string[];
}

export interface VoiceSetting {
  /** Identificatore della voce nel browser in cui è stata scelta. */
  voiceURI: string | null;
  /** Nome e lingua della voce scelta: la ritrovano se l'identificatore cambia (altro browser). */
  voiceName?: string;
  voiceLang?: string;
  rate: number;
  pitch: number;
}

export type Mode = 'rehearsal' | 'memorize' | 'full';

export interface ScriptSettings {
  scriptId: string;
  role: string | null;
  voices: Record<string, VoiceSetting>;
  /** Indice del blocco su cui si trova la lettura. */
  position: number;
  mode: Mode;
  /** Id del blocco intestazione della scena selezionata; null = copione intero. */
  sceneId: string | null;
  /** Regia vocale: ritmo, pause, lettura delle didascalie. */
  pacing?: PacingSettings;
  /** Voce narrante per le didascalie (se lette). */
  narrator?: VoiceSetting;
}

export interface GlobalPrefs {
  /** Se attivo, usa solo voci dichiarate locali dal sistema (nessuna elaborazione remota). */
  strictPrivacy: boolean;
  /**
   * Genere delle voci di questo dispositivo, indicato dall'attore dopo l'ascolto
   * (identificatore della voce → genere). Il browser non fornisce questa informazione.
   */
  voiceGenders: Record<string, VoiceGender>;
}

export const DEFAULT_PREFS: GlobalPrefs = { strictPrivacy: true, voiceGenders: {} };

export function defaultSettings(scriptId: string): ScriptSettings {
  return { scriptId, role: null, voices: {}, position: 0, mode: 'rehearsal', sceneId: null };
}
