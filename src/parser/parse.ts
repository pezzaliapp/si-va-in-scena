import { EVERYONE, type Block, type Character, type Script } from '../types';
import type { Line } from './lines';

const UP = 'A-ZÀ-ÖØ-Þ';
const LOW = 'a-zß-öø-ÿ';

// "NOME: testo" (il nome può contenere punti, es. "SIG. ROSSI")
const UPPER_COLON = new RegExp(`^([${UP}][${UP}0-9'’.\\-&/, ]{0,48}?)\\s*(?:\\(([^)]*)\\))?\\s*:\\s*(.*)$`);
// "NOME. testo", "NOME - testo", "NOME" da solo
const UPPER_OTHER = new RegExp(`^([${UP}][${UP}0-9'’\\-&/, ]{0,48}?)\\s*(?:\\(([^)]*)\\))?\\s*(?:([.\\-–—])\\s*(.*))?$`);
// "Nome: testo" (solo con i due punti)
const MIXED_COLON = new RegExp(`^([${UP}][${LOW}'’]+(?:\\s+[${UP}]?[${LOW}'’]+){0,2})\\s*(?:\\(([^)]*)\\))?\\s*:\\s*(.*)$`);

const ORDINALS =
  'PRIM[OA]|SECOND[OA]|TERZ[OA]|QUART[OA]|QUINT[OA]|SEST[OA]|SETTIM[OA]|OTTAV[OA]|NON[OA]|DECIM[OA]|UNIC[OA]|ULTIM[OA]|FIRST|SECOND|THIRD|FOURTH|FIFTH|ONE|TWO|THREE|FOUR|FIVE';
const HEADING_NUMBERED = new RegExp(
  `^(ATTO|ACT|SCENA|SCENE|QUADRO|PARTE|TEMPO)\\s+([IVXLC]+|\\d+|${ORDINALS})\\b[^a-z]{0,60}`,
  'i',
);
const HEADING_ORDINAL_FIRST = new RegExp(`^(${ORDINALS})\\s+(ATTO|TEMPO|QUADRO|PARTE|SCENA)\\b`, 'i');
const HEADING_WORD = /^(PROLOGO|EPILOGO|PROLOGUE|EPILOGUE|INTERMEZZO|INTERVALLO)\b[^a-z]{0,40}$/;
const CAST_HEADER =
  /^(PERSONAGGI(\s+E\s+INTERPRETI)?|INTERPRETI|DRAMATIS PERSONAE|CHARACTERS|CAST)\s*[:.]?$/i;
const CAST_MAX_LINES = 40;

// Parole maiuscole che non sono mai nomi di personaggi.
const NOT_NAMES = new Set([
  'NO', 'SI', 'SÌ', 'OK', 'AH', 'OH', 'EH', 'BEH', 'MAH', 'BOH', 'AHI', 'EHI', 'OHI', 'UH', 'HA', 'HEY',
  'FINE', 'THE END', 'SIPARIO', 'BUIO', 'PAUSA', 'SILENZIO', 'NOTA', 'NOTE', 'CURTAIN', 'BLACKOUT',
  'END', 'INT', 'EXT', 'CUT TO', 'DISSOLVENZA', 'FADE OUT', 'FADE IN', 'MUSICA', 'LUCE', 'LUCI',
  'PERSONAGGI', 'INTERPRETI', 'CHARACTERS', 'CAST', 'ATTO', 'SCENA', 'ACT', 'SCENE', 'PROLOGO', 'EPILOGO',
]);
const EVERYONE_NAMES = new Set(['TUTTI', 'TUTTE', 'TUTTI INSIEME', 'TUTTE INSIEME', 'ALL', 'EVERYONE']);
const OFFSTAGE = /fuori\s*scena|f\.\s*s\.|da\s*fuori|dall'esterno|\boff\b|\bo\.\s*s\.|\bv\.\s*o\.|voce\s+fuori/i;
const TOGETHER = /insieme|contemporaneamente|simultane|together/i;
const MULTI_SEPARATOR = /\s*(?:,|\/|&|\bE\b|\bED\b|\bAND\b)\s*/;

interface Cue {
  key: string;
  display: string;
  note?: string;
  rest: string;
  style: 'colon' | 'other' | 'standalone' | 'mixed';
  /** Separatore a trattino ("NOME - testo"): segnale forte quanto i due punti. */
  dash?: boolean;
}

function normKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.’]/g, (c) => (c === '’' ? "'" : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function letters(s: string): number {
  return (s.match(new RegExp(`[${UP}${LOW}]`, 'g')) ?? []).length;
}

function looksLikeName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  return letters(name) >= 2 && words.length <= 5 && name.length <= 40;
}

/** Riconosce una possibile intestazione di battuta, senza decidere se il nome è valido. */
export function matchCue(text: string): Cue | null {
  let m = UPPER_COLON.exec(text);
  if (m && looksLikeName(m[1]!)) {
    return { key: normKey(m[1]!), display: m[1]!.trim(), note: m[2]?.trim(), rest: m[3]!.trim(), style: 'colon' };
  }
  m = UPPER_OTHER.exec(text);
  if (m && looksLikeName(m[1]!)) {
    const sep = m[3];
    const rest = (m[4] ?? '').trim();
    // Dopo il punto deve iniziare una frase, non continuare una parola maiuscola.
    if (sep === '.' && rest && !new RegExp(`^[${UP}(«"“'‘…\\[\\-–—¿¡]`).test(rest)) return null;
    if (sep && sep !== '.' && !rest) return null;
    return {
      key: normKey(m[1]!),
      display: m[1]!.trim(),
      note: m[2]?.trim(),
      rest,
      style: sep ? 'other' : 'standalone',
      ...(sep && sep !== '.' ? { dash: true } : {}),
    };
  }
  m = MIXED_COLON.exec(text);
  if (m) {
    return { key: normKey(m[1]!), display: m[1]!.trim(), note: m[2]?.trim(), rest: m[3]!.trim(), style: 'mixed' };
  }
  return null;
}

export function headingLevel(text: string): 1 | 2 | null {
  if (text.length > 80) return null;
  const m = HEADING_NUMBERED.exec(text) ?? HEADING_ORDINAL_FIRST.exec(text);
  const word = m ? (HEADING_NUMBERED.test(text) ? m[1]! : m[2]!) : HEADING_WORD.exec(text)?.[1];
  if (!word) return null;
  return /^(SCENA|SCENE|QUADRO)$/i.test(word) ? 2 : 1;
}

function splitMulti(key: string): string[] {
  return key.split(MULTI_SEPARATOR).map((s) => s.trim()).filter(Boolean);
}

function isParenBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
  }
  return depth === 0;
}

/** Testo che continua dopo una parentesi chiusa sulla stessa riga, es. "(ride) Ma dai". */
function hasTextAfterParen(text: string): boolean {
  const close = Math.max(text.indexOf(')'), text.indexOf(']'));
  return close >= 0 && close < text.length - 1 && /[\p{L}\p{N}]/u.test(text.slice(close + 1));
}

function appendText(prev: string, next: string): string {
  if (!prev) return next;
  if (/[\p{Ll}]-$/u.test(prev) && /^[\p{Ll}]/u.test(next)) return prev.slice(0, -1) + next;
  return prev + ' ' + next;
}

export interface ParseOptions {
  fileName: string;
  title?: string;
  id?: string;
  now?: number;
}

/**
 * Analizza le righe di un copione e ne ricava personaggi, battute,
 * didascalie e intestazioni. Le attribuzioni incerte vengono segnalate
 * nel campo `ambiguous` invece di essere indovinate.
 */
export function parseScript(lines: Line[], opts: ParseOptions): Script {
  // Primo passaggio: conteggio dei possibili nomi.
  const counts = new Map<string, { n: number; display: string; strong: boolean }>();
  const cues = lines.map((l) => (headingLevel(l.text) ? null : matchCue(l.text)));
  cues.forEach((c, i) => {
    if (!c) return;
    // Un nome isolato su una riga vale solo se seguito da testo.
    if (c.style === 'standalone' && !lines[i + 1]) return;
    const parts = splitMulti(c.key);
    for (const part of parts.length > 1 ? [c.key, ...parts] : [c.key]) {
      const e = counts.get(part) ?? { n: 0, display: part === c.key ? c.display : part, strong: false };
      e.n++;
      if (c.style === 'colon' || c.style === 'standalone' || c.dash) e.strong = true;
      counts.set(part, e);
    }
  });

  const isAccepted = (key: string, style: Cue['style']): boolean => {
    if (NOT_NAMES.has(key)) return false;
    const e = counts.get(key);
    if (!e) return false;
    if (style === 'mixed') return e.n >= 3;
    return e.n >= 3 || (e.n >= 2 && e.strong);
  };

  const characters: Character[] = [];
  const idByKey = new Map<string, string>();
  const characterId = (key: string, display: string): string => {
    let id = idByKey.get(key);
    if (!id) {
      id = `p${characters.length + 1}`;
      idByKey.set(key, id);
      characters.push({ id, name: counts.get(key)?.display ?? display });
    }
    return id;
  };

  const rareNames = new Set<string>();

  /** Restituisce gli id dei personaggi, oppure null se il nome non è riconosciuto. */
  const resolveSpeakers = (cue: Cue): string[] | null => {
    if (EVERYONE_NAMES.has(cue.key)) return [EVERYONE];
    const parts = splitMulti(cue.key);
    if (parts.length > 1 && parts.every((p) => EVERYONE_NAMES.has(p) || isAccepted(p, 'colon'))) {
      return parts.map((p) => (EVERYONE_NAMES.has(p) ? EVERYONE : characterId(p, p)));
    }
    if (isAccepted(cue.key, cue.style)) return [characterId(cue.key, cue.display)];
    // "NOME: testo" è un segnale forte: un personaggio con una sola battuta
    // viene creato comunque, ma segnalato da verificare.
    if (cue.style === 'colon' && !NOT_NAMES.has(cue.key)) {
      rareNames.add(cue.key);
      return [characterId(cue.key, cue.display)];
    }
    return null;
  };

  const blocks: Block[] = [];
  let cur: Block | null = null;
  let curIsClosedParen = false;
  let openParen = false;
  let castLeft = 0;
  let lastSpeech: Block | null = null;

  const push = (b: Omit<Block, 'id'>): Block => {
    const block = { id: `b${blocks.length + 1}`, ...b };
    blocks.push(block);
    cur = block;
    curIsClosedParen = false;
    return block;
  };

  lines.forEach((line, i) => {
    const t = line.text;

    if (openParen && cur) {
      cur.text = appendText(cur.text, t);
      openParen = !isParenBalanced(cur.text);
      curIsClosedParen = !openParen;
      return;
    }

    const level = headingLevel(t);
    if (level) {
      push({ kind: 'heading', speakers: [], text: t, level, page: line.page });
      castLeft = 0;
      return;
    }

    if (CAST_HEADER.test(t)) {
      push({ kind: 'direction', speakers: [], text: t, page: line.page });
      castLeft = CAST_MAX_LINES;
      return;
    }
    if (castLeft > 0) {
      castLeft--;
      const c: Block | null = cur;
      if (c && c.kind === 'direction') c.text += '\n' + t;
      else push({ kind: 'direction', speakers: [], text: t, page: line.page });
      return;
    }

    const cue = cues[i];
    const speakers = cue ? resolveSpeakers(cue) : null;
    if (cue && speakers) {
      const note = cue.note || undefined;
      const block = push({
        kind: 'speech',
        speakers,
        text: cue.rest,
        page: line.page,
        ...(note ? { note } : {}),
        ...(rareNames.has(cue.key) ? { ambiguous: `Personaggio con una sola battuta: "${cue.display}"` } : {}),
        ...(note && OFFSTAGE.test(note) ? { offstage: true } : {}),
        ...(speakers.length > 1 || speakers[0] === EVERYONE || (note && TOGETHER.test(note))
          ? { simultaneous: true }
          : {}),
      });
      lastSpeech = block;
      return;
    }

    const unknownName =
      cue && cue.style !== 'mixed' && !NOT_NAMES.has(cue.key)
        ? `Possibile personaggio non riconosciuto: "${cue.display}"`
        : undefined;
    const c = cur as Block | null;

    if (/^[([]/.test(t)) {
      if (c && c.kind === 'speech' && !curIsClosedParen && !line.paragraphBreak && hasTextAfterParen(t)) {
        c.text = appendText(c.text, t);
        return;
      }
      push({ kind: 'direction', speakers: [], text: t, page: line.page });
      openParen = !isParenBalanced(t);
      curIsClosedParen = !openParen;
      return;
    }

    // Testo semplice senza nome di personaggio.
    if (c && c.kind === 'speech' && (!line.paragraphBreak || c.text === '')) {
      c.text = appendText(c.text, t);
      if (unknownName && !c.ambiguous) c.ambiguous = unknownName;
      return;
    }
    if (c && c.kind === 'direction' && curIsClosedParen && lastSpeech) {
      const names = lastSpeech.speakers
        .map((id) => (id === EVERYONE ? 'TUTTI' : characters.find((ch) => ch.id === id)?.name ?? id))
        .join(', ');
      lastSpeech = push({
        kind: 'speech',
        speakers: [...lastSpeech.speakers],
        text: t,
        page: line.page,
        ambiguous: unknownName ?? `Battuta senza nome dopo una didascalia: attribuita a ${names}`,
      });
      return;
    }
    if (c && c.kind === 'direction' && !curIsClosedParen && !line.paragraphBreak) {
      c.text = appendText(c.text, t);
      return;
    }
    const block = push({ kind: 'direction', speakers: [], text: t, page: line.page });
    if (unknownName) block.ambiguous = unknownName;
    else if (c && c.kind === 'speech') {
      block.ambiguous = 'Paragrafo senza nome di personaggio: considerato didascalia';
    }
  });

  for (const b of blocks) {
    if (b.kind === 'speech' && !b.text && !b.ambiguous) b.ambiguous = 'Battuta senza testo';
  }

  const now = opts.now ?? Date.now();
  const warnings: string[] = [];
  if (characters.length === 0) {
    warnings.push(
      'Nessun personaggio riconosciuto. Il formato del copione potrebbe non essere supportato: verifica e correggi manualmente.',
    );
  }
  const ambiguousCount = blocks.filter((b) => b.ambiguous).length;
  if (ambiguousCount > 0) warnings.push(`${ambiguousCount} passaggi da verificare.`);

  return {
    id: opts.id ?? `s${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title: opts.title?.trim() || opts.fileName.replace(/\.pdf$/i, ''),
    fileName: opts.fileName,
    importedAt: now,
    updatedAt: now,
    characters,
    blocks,
    warnings,
  };
}
