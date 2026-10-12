// Regia vocale: trasforma il testo di una battuta in una sequenza di frasi da
// pronunciare e pause temporizzate. Non dipende dal browser né dal parser.
import { segmentSpeech } from '../script/segments';

export interface PacingSettings {
  /** Ritmo generale: 1 = naturale, <1 più disteso, >1 più serrato. */
  tempo: number;
  /** Pausa tra la battuta di un personaggio e quella successiva (ms, a ritmo 1). */
  speakerPauseMs: number;
  /** Pausa dopo il comando "Continua" sul turno dell'attore (ms, a ritmo 1). */
  afterActorPauseMs: number;
  /** Legge anche le didascalie con la voce narrante. */
  readDirections: boolean;
}

export const DEFAULT_PACING: PacingSettings = {
  tempo: 1,
  speakerPauseMs: 450,
  afterActorPauseMs: 350,
  readDirections: false,
};

export const TEMPO_MIN = 0.7;
export const TEMPO_MAX = 1.4;
/** Nessuna pausa calcolata supera questo valore: oltre, il dialogo diventa innaturale. */
export const MAX_PAUSE_MS = 1500;

/** Parte di una battuta, nell'ordine del testo originale. */
export type Part =
  | { kind: 'sentence'; text: string; pauseAfterMs: number }
  | { kind: 'direction'; text: string };

/** Pause di base dopo la punteggiatura finale (ms, a ritmo 1). */
const PAUSE = {
  period: 380,
  question: 420,
  exclamation: 380,
  ellipsis: 600,
  ellipsisMid: 420,
  colonOrSemicolon: 260,
  comma: 140,
};

/** Abbreviazioni dopo le quali il punto non chiude la frase. */
const ABBREVIATIONS = new Set([
  'sig', 'sigg', 'sig.ra', 'sigra', 'dott', 'dott.ssa', 'dssa', 'prof', 'prof.ssa', 'avv', 'ing', 'arch', 'geom',
  'rag', 'egr', 'gent', 'mons', 'p', 'pag', 'ecc', 'etc', 'cfr', 'tel', 'n', 'nr', 'vol',
  'st', 's', 'ss', 'mr', 'mrs', 'ms', 'dr', 'jr', 'sr', 'vs', 'fig', 'cap',
]);

/** Lunghezza oltre la quale una frase viene divisa (alcuni motori troncano gli enunciati lunghi). */
const LONG_SENTENCE = 220;

function terminalPause(sentence: string): number {
  const t = sentence.replace(/["»”’)\]]+$/, '').trimEnd();
  if (/(\.\.\.|…)$/.test(t)) return PAUSE.ellipsis;
  if (/[?]+!*$|!+\?+$/.test(t)) return PAUSE.question;
  if (/!+$/.test(t)) return PAUSE.exclamation;
  if (/[;:]$/.test(t)) return PAUSE.colonOrSemicolon;
  if (/,$/.test(t)) return PAUSE.comma;
  if (/[-–—]$/.test(t)) return 0; // frase interrotta: si prosegue subito
  return PAUSE.period;
}

/**
 * Divide un testo in frasi. Rispetta abbreviazioni, numeri decimali,
 * punteggiatura multipla e virgolette di chiusura. I puntini di sospensione
 * dividono anche a metà frase ("Io… non so"), con una pausa più breve.
 * Le virgole non dividono: l'intonazione resta affidata al motore vocale.
 */
export function splitSentences(text: string): { text: string; pauseAfterMs: number }[] {
  const src = text.replace(/\s+/g, ' ').trim();
  if (!src) return [];
  const pieces: { text: string; mid: boolean }[] = [];
  let start = 0;
  const re = /(\.\.\.|…|[.!?]+)(["»”’)\]]*)(\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = m.index + m[1]!.length + m[2]!.length;
    const piece = src.slice(start, end).trim();
    const nextChar = src.charAt(re.lastIndex);
    const isEllipsis = m[1] === '...' || m[1] === '…';
    if (m[1] === '.') {
      const word = /(?:^|[\s(«"“])([\p{L}.]+)\.$/u.exec(src.slice(start, m.index + 1))?.[1] ?? '';
      // Abbreviazione o iniziale puntata ("G. Verdi"): non è fine frase.
      if (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word)) continue;
      if (nextChar && /\p{Ll}/u.test(nextChar)) continue;
    } else if (!isEllipsis && nextChar && /\p{Ll}/u.test(nextChar)) {
      continue; // "Chi? lui?" resta insieme
    }
    if (piece) pieces.push({ text: piece, mid: isEllipsis && !!nextChar && /\p{Ll}/u.test(nextChar) });
    start = re.lastIndex;
  }
  const tail = src.slice(start).trim();
  if (tail) pieces.push({ text: tail, mid: false });

  const out: { text: string; pauseAfterMs: number }[] = [];
  for (const p of pieces) {
    for (const part of splitLong(p.text)) out.push({ text: part.text, pauseAfterMs: part.pause });
    out.at(-1)!.pauseAfterMs = p.mid ? PAUSE.ellipsisMid : terminalPause(p.text);
  }
  return out;
}

/** Divide una frase molto lunga su punto e virgola o virgola, con pause brevi. */
function splitLong(sentence: string): { text: string; pause: number }[] {
  const out: { text: string; pause: number }[] = [];
  let s = sentence;
  while (s.length > LONG_SENTENCE) {
    const window = s.slice(0, LONG_SENTENCE);
    let cut = window.lastIndexOf(';');
    let pause = PAUSE.colonOrSemicolon;
    if (cut < LONG_SENTENCE / 3) {
      cut = window.lastIndexOf(',');
      pause = PAUSE.comma;
    }
    if (cut < LONG_SENTENCE / 3) {
      cut = window.lastIndexOf(' ');
      pause = 0;
    }
    if (cut <= 0) break;
    out.push({ text: s.slice(0, cut + 1).trim(), pause });
    s = s.slice(cut + 1).trim();
  }
  if (s) out.push({ text: s, pause: 0 });
  return out;
}

/** Scompone una battuta in frasi da pronunciare e didascalie interne, nell'ordine originale. */
export function performBlock(text: string): Part[] {
  const parts: Part[] = [];
  for (const seg of segmentSpeech(text)) {
    if (seg.kind === 'direction') parts.push({ kind: 'direction', text: seg.text });
    else for (const s of splitSentences(seg.text)) parts.push({ kind: 'sentence', ...s });
  }
  return parts;
}

/** Vero se la battuta termina interrotta ("Ma io—", "Aspetta…"): chi segue attacca subito. */
export function endsInterrupted(text: string): boolean {
  const spoken = segmentSpeech(text)
    .filter((s) => s.kind === 'spoken')
    .map((s) => s.text)
    .join(' ')
    .replace(/["»”’)\]]+$/, '')
    .trimEnd();
  return /([-–—]|\.\.\.|…)$/.test(spoken);
}

export type Step =
  | { type: 'say'; text: string; narrator: boolean; part: number }
  | { type: 'pause'; ms: number };

export function scalePause(ms: number, tempo: number): number {
  const t = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, tempo || 1));
  return Math.round(Math.min(MAX_PAUSE_MS, Math.max(0, ms / t)));
}

/** Velocità della voce: il ritmo la modifica solo leggermente; il grosso lo fanno le pause. */
export function scaleRate(rate: number, tempo: number): number {
  const t = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, tempo || 1));
  return Math.round(rate * (0.85 + 0.15 * t) * 100) / 100;
}

/**
 * Sequenza di passi per una battuta: eventuale pausa d'attacco, frasi e pause
 * tra le frasi. Le didascalie interne si leggono solo se richiesto.
 */
export function buildSteps(parts: Part[], pacing: PacingSettings, leadInMs: number, narratorOnly = false): Step[] {
  const steps: Step[] = [];
  if (leadInMs > 0) steps.push({ type: 'pause', ms: leadInMs });
  const speakable = parts
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.kind === 'sentence' || pacing.readDirections);
  speakable.forEach(({ p, i }, k) => {
    const narrator = narratorOnly || p.kind === 'direction';
    const text = p.kind === 'direction' ? p.text.replace(/^[([]\s*|\s*[)\]]$/g, '') : p.text;
    steps.push({ type: 'say', text, narrator, part: i });
    if (k < speakable.length - 1) {
      const base = p.kind === 'sentence' ? p.pauseAfterMs : 300;
      const pause = scalePause(base, pacing.tempo);
      if (pause > 0) steps.push({ type: 'pause', ms: pause });
    }
  });
  return steps;
}

/** Come si arriva a una battuta: per scorrimento automatico, dopo il turno dell'attore o per comando. */
export type Arrival = 'auto' | 'afterActor' | 'user';

/** Pausa d'attacco prima di una battuta. */
export function leadIn(arrival: Arrival, prevText: string | undefined, sameSpeaker: boolean, pacing: PacingSettings): number {
  if (arrival === 'user') return 0;
  if (arrival === 'afterActor') return scalePause(pacing.afterActorPauseMs, pacing.tempo);
  if (prevText !== undefined && endsInterrupted(prevText)) return scalePause(Math.min(120, pacing.speakerPauseMs), pacing.tempo);
  if (sameSpeaker) return scalePause(Math.min(300, pacing.speakerPauseMs), pacing.tempo);
  return scalePause(pacing.speakerPauseMs, pacing.tempo);
}
