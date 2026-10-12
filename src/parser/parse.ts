import { segmentSpeech, wordCount } from '../script/segments';
import { EVERYONE, type Block, type CueStyle, type ParseStats, type Script } from '../types';
import type { Line } from './lines';

const UP = 'A-ZÀ-ÖØ-Þ';
const LOW = 'a-zß-öø-ÿ';
const NAME_CHARS = `${UP}0-9'’.\\-&/, `;

// "NOME: testo" (il nome può contenere punti, es. "SIG. ROSSI")
const UPPER_COLON = new RegExp(`^([${UP}][${NAME_CHARS}]{0,48}?)\\s*(?:\\(([^)]*)\\))?\\s*:\\s*(.*)$`);
// "NOME. testo", "NOME - testo", "NOME" da solo
const UPPER_OTHER = new RegExp(
  `^([${UP}][${UP}0-9'’\\-&/, ]{0,48}?)\\s*(?:\\(([^)]*)\\))?\\s*(?:([.\\-–—])\\s*(.*))?$`,
);
// "NOME testo": nome in maiuscolo seguito direttamente dalla battuta
const UPPER_SPACE = new RegExp(
  `^((?:[${UP}][${UP}0-9'’.\\-]*\\s+){0,3}[${UP}][${UP}0-9'’.\\-]*)\\s*(?:\\(([^)]*)\\))?\\s+((?:[^\\s]*[${LOW}]|[(«"“'‘…\\[¿¡]).*)$`,
);
// "Nome: testo"
const MIXED_COLON = new RegExp(
  `^([${UP}][${LOW}'’]+(?:\\s+[${UP}]?[${LOW}'’]+){0,2})\\s*(?:\\(([^)]*)\\))?\\s*:\\s*(.*)$`,
);
// Nome isolato (in una cella, in grassetto o prima di una tabulazione)
const NAME_ONLY = new RegExp(
  `^([${UP}][${NAME_CHARS}]{0,48}?|[${UP}][${LOW}'’]+(?:\\s+[${UP}]?[${LOW}'’]+){0,2})\\s*(?:\\(([^)]*)\\))?\\s*[:.]?$`,
);

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
const CAST_MAX_LINES = 60;
/** Righe oltre le quali una parentesi aperta viene considerata non chiusa. */
const OPEN_PAREN_MAX_LINES = 15;
/** Didascalie interne più lunghe di così diventano blocchi autonomi. */
const INLINE_DIRECTION_MAX_WORDS = 8;

// Parole maiuscole che non sono mai nomi di personaggi.
const NOT_NAMES = new Set([
  'NO', 'SI', 'SÌ', 'OK', 'AH', 'OH', 'EH', 'BEH', 'MAH', 'BOH', 'AHI', 'EHI', 'OHI', 'UH', 'HA', 'HEY', 'IO',
  'TU', 'LUI', 'LEI', 'NOI', 'VOI', 'LORO', 'MA', 'E', 'O', 'IL', 'LA', 'LO', 'GLI', 'LE', 'UN', 'UNA', 'CHE',
  'FINE', 'THE END', 'SIPARIO', 'BUIO', 'PAUSA', 'SILENZIO', 'NOTA', 'NOTE', 'CURTAIN', 'BLACKOUT',
  'END', 'INT', 'EXT', 'CUT TO', 'DISSOLVENZA', 'FADE OUT', 'FADE IN', 'MUSICA', 'LUCE', 'LUCI',
  'PERSONAGGI', 'INTERPRETI', 'CHARACTERS', 'CAST', 'ATTO', 'SCENA', 'ACT', 'SCENE', 'PROLOGO', 'EPILOGO',
  'TV', 'SMS', 'PS',
]);
const EVERYONE_NAMES = new Set(['TUTTI', 'TUTTE', 'TUTTI INSIEME', 'TUTTE INSIEME', 'ALL', 'EVERYONE']);
const OFFSTAGE = /fuori\s*scena|f\.\s*s\.|da\s*fuori|dall'esterno|\boff\b|\bo\.\s*s\.|\bv\.\s*o\.|voce\s+fuori/i;
const TOGETHER = /insieme|contemporaneamente|simultane|together/i;
const MULTI_SEPARATOR = /\s*(?:,|\/|&|\bE\b|\bED\b|\bAND\b)\s*/;

/** Formati in cui il nome è separato in modo inequivocabile dalla battuta. */
const STRONG: ReadonlySet<CueStyle> = new Set(['colon', 'dash', 'tab', 'bold', 'standalone']);
/** Sopra questo numero di battute in formato forte, i formati deboli valgono solo per nomi già noti. */
const STRONG_DOMINANT = 10;

export const CUE_STYLE_LABEL: Record<CueStyle, string> = {
  colon: 'NOME: battuta',
  dash: 'NOME - battuta',
  dot: 'NOME. battuta',
  tab: 'nome in colonna, separato dalla battuta',
  bold: 'nome in grassetto seguito dalla battuta',
  standalone: 'nome su una riga da solo, battuta sotto',
  space: 'NOME battuta (senza separatore)',
  mixed: 'Nome: battuta',
  mixedTab: 'Nome in colonna, separato dalla battuta',
};

interface Cue {
  key: string;
  display: string;
  note?: string;
  rest: string;
  style: CueStyle;
}

function normKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.’:]/g, (c) => (c === '’' ? "'" : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function letters(s: string): number {
  return (s.match(new RegExp(`[${UP}${LOW}]`, 'g')) ?? []).length;
}

function looksLikeName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  return letters(name) >= 2 && words.length <= 5 && name.trim().length <= 40;
}

const UPPER_NAME = new RegExp(`^[${UP}][${NAME_CHARS}]*$`);
const HAS_LOWER = new RegExp(`[${LOW}]`);
const isUpperName = (s: string) => UPPER_NAME.test(s.trim()) && !HAS_LOWER.test(s);

function makeCue(name: string, note: string | undefined, rest: string, style: CueStyle): Cue {
  return {
    key: normKey(name),
    display: name.trim().replace(/[:.]$/, '').trim(),
    note: note?.trim() || undefined,
    rest: rest.replace(/\t/g, ' ').trim(),
    style,
  };
}

/** Riconosce una possibile intestazione di battuta, senza decidere se il nome è valido. */
export function matchCue(input: Line | string): Cue | null {
  const line: Line = typeof input === 'string' ? { text: input, page: 1, paragraphBreak: false } : input;
  const raw = line.text;

  // 1. Nome separato dalla battuta da uno spazio ampio (tabulazione, colonna, tabella).
  const tab = raw.indexOf('\t');
  if (tab > 0) {
    const m = NAME_ONLY.exec(raw.slice(0, tab).trim());
    const rest = raw.slice(tab + 1);
    if (m && looksLikeName(m[1]!) && rest.trim()) {
      return makeCue(m[1]!, m[2], rest, isUpperName(m[1]!) ? 'tab' : 'mixedTab');
    }
  }

  // 2. Nome in grassetto seguito da testo normale.
  const runs = line.runs?.filter((r) => r.text.trim());
  if (runs && runs.length > 1 && runs[0]!.bold && runs.slice(1).some((r) => !r.bold)) {
    const head = runs[0]!.text.trim();
    const m = NAME_ONLY.exec(head);
    if (m && looksLikeName(m[1]!)) {
      return makeCue(m[1]!, m[2], raw.slice(raw.indexOf(head) + head.length), 'bold');
    }
  }

  const text = raw.replace(/\t/g, ' ');
  let m = UPPER_COLON.exec(text);
  if (m && looksLikeName(m[1]!)) return makeCue(m[1]!, m[2], m[3]!, 'colon');

  m = UPPER_OTHER.exec(text);
  if (m && looksLikeName(m[1]!)) {
    const sep = m[3];
    const rest = (m[4] ?? '').trim();
    if (!sep) return makeCue(m[1]!, m[2], '', 'standalone');
    if (sep === '.') {
      // Dopo il punto deve iniziare una frase, non continuare una parola maiuscola.
      if (rest && !new RegExp(`^[${UP}(«"“'‘…\\[\\-–—¿¡]`).test(rest)) return null;
      return makeCue(m[1]!, m[2], rest, rest ? 'dot' : 'standalone');
    }
    if (rest) return makeCue(m[1]!, m[2], rest, 'dash');
  }

  m = MIXED_COLON.exec(text);
  if (m) return makeCue(m[1]!, m[2], m[3]!, 'mixed');

  m = UPPER_SPACE.exec(text);
  if (m && looksLikeName(m[1]!)) return makeCue(m[1]!, m[2], m[3]!, 'space');

  return null;
}

export function headingLevel(text: string): 1 | 2 | null {
  const t = text.replace(/\t/g, ' ');
  if (t.length > 80) return null;
  const m = HEADING_NUMBERED.exec(t) ?? HEADING_ORDINAL_FIRST.exec(t);
  const word = m ? (HEADING_NUMBERED.test(t) ? m[1]! : m[2]!) : HEADING_WORD.exec(t)?.[1];
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
  const n = next.replace(/\t/g, ' ');
  if (!prev) return n;
  if (/[\p{Ll}]-$/u.test(prev) && /^[\p{Ll}]/u.test(n)) return prev.slice(0, -1) + n;
  return prev + ' ' + n;
}

const MIXED_NAME = new RegExp(`^[${UP}][${LOW}'’]+(?:\\s+[${UP}]?[${LOW}'’]+){0,2}$`);

/** Nome all'inizio di una voce dell'elenco personaggi ("VERA, guardiana del faro"). */
function castEntryName(text: string): string | null {
  const head = text.split(/\t|,|:|;|\s[-–—]\s|\s\(|\s{2,}/)[0]!.trim().replace(/[.]$/, '');
  if (!head || !looksLikeName(head) || head.split(/\s+/).length > 4) return null;
  return isUpperName(head) || MIXED_NAME.test(head) ? normKey(head) : null;
}

/**
 * Separa dalle battute le didascalie interne lunghe o non chiuse, che
 * diventano blocchi autonomi nella stessa posizione. Le didascalie brevi
 * ("(ride)", "(chiama)") restano nella battuta. Nessun testo viene perso:
 * i blocchi risultanti, concatenati, riproducono il testo originale.
 */
export function separateInlineDirections(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind !== 'speech') {
      out.push(b);
      continue;
    }
    const segs = segmentSpeech(b.text);
    const isLong = (s: (typeof segs)[number]) =>
      s.kind === 'direction' && (s.unclosed || wordCount(s.text) > INLINE_DIRECTION_MAX_WORDS);
    if (!segs.some(isLong)) {
      out.push(b);
      continue;
    }
    // Raggruppa: parti di battuta (testo + didascalie brevi) e didascalie lunghe.
    const groups: { direction: boolean; text: string; unclosed?: boolean }[] = [];
    for (const s of segs) {
      const last = groups.at(-1);
      if (isLong(s)) groups.push({ direction: true, text: s.text, unclosed: s.unclosed });
      else if (last && !last.direction) last.text += ' ' + s.text;
      else groups.push({ direction: false, text: s.text });
    }
    let k = 0;
    let firstSpeech = true;
    for (const g of groups) {
      const id = k === 0 ? b.id : `${b.id}.${k}`;
      k++;
      const hasSpoken = !g.direction && segmentSpeech(g.text).some((s) => s.kind === 'spoken');
      if (!hasSpoken) {
        const prev = out.at(-1);
        // Didascalie consecutive nate dalla stessa battuta vengono unite.
        if (prev && prev.kind === 'direction' && prev.id.startsWith(`${b.id}.`)) prev.text += ' ' + g.text;
        else {
          out.push({
            id,
            kind: 'direction',
            speakers: [],
            text: g.text,
            page: b.page,
            ...(g.unclosed ? { ambiguous: 'Parentesi della didascalia non chiusa: verificare dove termina' } : {}),
          });
        }
        continue;
      }
      out.push(
        firstSpeech
          ? { ...b, id, text: g.text }
          : {
              id,
              kind: 'speech',
              speakers: [...b.speakers],
              text: g.text,
              page: b.page,
              ...(b.simultaneous ? { simultaneous: true } : {}),
              ...(b.offstage ? { offstage: true } : {}),
            },
      );
      firstSpeech = false;
    }
  }
  return out;
}

export interface ParseOptions {
  fileName: string;
  title?: string;
  id?: string;
  now?: number;
}

/**
 * Analizza le righe di un copione e ne ricava frontespizio, elenco dei
 * personaggi, battute, didascalie e intestazioni. Il formato delle battute
 * viene dedotto dal documento stesso; le attribuzioni incerte vengono
 * segnalate nel campo `ambiguous` invece di essere indovinate.
 */
export function parseScript(lines: Line[], opts: ParseOptions): Script {
  const title = opts.title?.trim() || opts.fileName.replace(/\.pdf$/i, '');
  const titleKey = normKey(title);

  // Passaggio 0: elenco dei personaggi, se presente (termina a fine pagina o a un'intestazione).
  const castLine = new Set<number>();
  const castNames = new Set<string>();
  lines.forEach((l, i) => {
    if (!CAST_HEADER.test(l.text.replace(/\t/g, ' ').trim())) return;
    for (let j = i + 1; j < lines.length && j <= i + CAST_MAX_LINES; j++) {
      const e = lines[j]!;
      if (headingLevel(e.text) || e.page !== l.page) break;
      castLine.add(j);
      const name = castEntryName(e.text);
      if (name) castNames.add(name);
    }
  });

  // Primo passaggio: possibili nomi, con il formato in cui compaiono.
  const isBigType = (l: Line) => (l.size ?? 1) >= 1.4;
  const cues = lines.map((l, i) => {
    if (castLine.has(i) || headingLevel(l.text) || isBigType(l) || l.italic) return null;
    const c = matchCue(l);
    if (!c || c.key === titleKey || NOT_NAMES.has(c.key)) return null;
    // Un nome isolato su una riga vale solo se seguito da testo.
    if (c.style === 'standalone') {
      const next = lines[i + 1];
      if (!next || matchCue(next)?.style === 'standalone' || headingLevel(next.text)) return null;
    }
    return c;
  });
  const counts = new Map<string, { n: number; strong: number; display: string }>();
  let strongTotal = 0;
  for (const c of cues) {
    if (!c) continue;
    const parts = splitMulti(c.key);
    if (STRONG.has(c.style)) strongTotal++;
    for (const part of parts.length > 1 ? [c.key, ...parts] : [c.key]) {
      const e = counts.get(part) ?? { n: 0, strong: 0, display: part === c.key ? c.display : part };
      e.n++;
      if (STRONG.has(c.style)) e.strong++;
      counts.set(part, e);
    }
  }

  const known = (key: string) => castNames.has(key) || (counts.get(key)?.strong ?? 0) >= 2;
  const isAccepted = (key: string, style: CueStyle): boolean => {
    if (NOT_NAMES.has(key) || key === titleKey) return false;
    if (known(key)) return true;
    if (STRONG.has(style)) return false;
    // Formati deboli: se il documento usa già un formato forte, valgono solo per nomi noti.
    if (strongTotal >= STRONG_DOMINANT) return false;
    return (counts.get(key)?.n ?? 0) >= 3;
  };

  const characters: Script['characters'] = [];
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
  const resolveSpeakers = (c: Cue, inBody: boolean): string[] | null => {
    if (EVERYONE_NAMES.has(c.key)) return [EVERYONE];
    const parts = splitMulti(c.key);
    if (parts.length > 1 && parts.every((p) => EVERYONE_NAMES.has(p) || isAccepted(p, 'colon'))) {
      return parts.map((p) => (EVERYONE_NAMES.has(p) ? EVERYONE : characterId(p, p)));
    }
    if (isAccepted(c.key, c.style)) return [characterId(c.key, c.display)];
    // Un nome con una sola battuta in formato forte viene creato, ma segnalato.
    if (inBody && (c.style === 'colon' || c.style === 'tab' || c.style === 'bold') && c.rest) {
      rareNames.add(c.key);
      return [characterId(c.key, c.display)];
    }
    return null;
  };

  const blocks: Block[] = [];
  const formats: Partial<Record<CueStyle, number>> = {};
  let cur: Block | null = null;
  let curIsClosedParen = false;
  let openParen = false;
  let lastSpeech: Block | null = null;
  let inBody = false;
  let openParenLines = 0;
  /** La riga i è una battuta in formato forte di un personaggio già riconosciuto. */
  const cueStrongAccepted = (i: number) => {
    const c = cues[i];
    return !!c && STRONG.has(c.style) && c.style !== 'standalone' && known(c.key);
  };
  const trackParen = (b: Block) => {
    openParen = !isParenBalanced(b.text);
    openParenLines = 0;
  };

  const push = (b: Omit<Block, 'id'>): Block => {
    const block = { id: `b${blocks.length + 1}`, ...b };
    blocks.push(block);
    cur = block;
    curIsClosedParen = false;
    return block;
  };
  const speakerNames = (ids: string[]) =>
    ids.map((id) => (id === EVERYONE ? 'TUTTI' : (characters.find((ch) => ch.id === id)?.name ?? id))).join(', ');

  lines.forEach((line, i) => {
    const t = line.text.replace(/\t/g, ' ');

    // Didascalia aperta (autonoma o interna a una battuta): le righe successive
    // ne fanno parte finché la parentesi non si chiude, anche se iniziano con un
    // nome in maiuscolo. Un'intestazione, una battuta inequivocabile dopo uno
    // stacco o troppe righe interrompono l'attesa e la parte viene segnalata.
    if (openParen && cur) {
      const c0 = cueStrongAccepted(i);
      if (headingLevel(line.text) || (line.paragraphBreak && c0) || openParenLines >= OPEN_PAREN_MAX_LINES) {
        openParen = false;
        cur.ambiguous ??= 'Parentesi della didascalia non chiusa: verificare dove termina';
      } else {
        cur.text = appendText(cur.text, t);
        openParenLines++;
        openParen = !isParenBalanced(cur.text);
        if (cur.kind === 'direction') curIsClosedParen = !openParen;
        return;
      }
    }

    const level = headingLevel(line.text);
    if (level) {
      inBody = true;
      push({ kind: 'heading', speakers: [], text: t, level, page: line.page });
      return;
    }

    if (castLine.has(i) || CAST_HEADER.test(t.trim())) {
      const c = cur as Block | null;
      if (c && c.kind === 'cast' && castLine.has(i)) c.text += '\n' + t;
      else push({ kind: 'cast', speakers: [], text: t, page: line.page });
      return;
    }

    const cueHere = cues[i];
    const speakers = cueHere ? resolveSpeakers(cueHere, inBody) : null;
    if (cueHere && speakers) {
      inBody = true;
      formats[cueHere.style] = (formats[cueHere.style] ?? 0) + 1;
      const note = cueHere.note;
      const block = push({
        kind: 'speech',
        speakers,
        text: cueHere.rest,
        page: line.page,
        ...(note ? { note } : {}),
        ...(note && OFFSTAGE.test(note) ? { offstage: true } : {}),
        ...(speakers.length > 1 || speakers[0] === EVERYONE || (note && TOGETHER.test(note))
          ? { simultaneous: true }
          : {}),
        ...(rareNames.has(cueHere.key) ? { ambiguous: `Personaggio con una sola battuta: "${cueHere.display}"` } : {}),
      });
      if ((line.text.match(/\t/g) ?? []).length >= 2) {
        block.ambiguous ??= 'Riga con più colonne: possibili battute affiancate, verificare';
      }
      lastSpeech = block;
      trackParen(block);
      return;
    }

    const c = cur as Block | null;

    // Prima del corpo del copione: titolo, crediti, note.
    if (!inBody) {
      if (c && c.kind === 'front' && !line.paragraphBreak && !isBigType(line)) c.text = appendText(c.text, t);
      else push({ kind: 'front', speakers: [], text: t, page: line.page });
      return;
    }

    const unknownName =
      cueHere && cueHere.style !== 'space' && cueHere.style !== 'mixed'
        ? `Possibile personaggio non riconosciuto: "${cueHere.display}"`
        : undefined;

    if (/^[([]/.test(t)) {
      if (c && c.kind === 'speech' && !curIsClosedParen && !line.paragraphBreak && hasTextAfterParen(t)) {
        c.text = appendText(c.text, t);
        trackParen(c);
        return;
      }
      push({ kind: 'direction', speakers: [], text: t, page: line.page });
      openParen = !isParenBalanced(t);
      openParenLines = 0;
      curIsClosedParen = !openParen;
      return;
    }

    // Riga interamente in corsivo: didascalia.
    if (line.italic) {
      if (c && c.kind === 'direction' && !curIsClosedParen && !line.paragraphBreak) c.text = appendText(c.text, t);
      else push({ kind: 'direction', speakers: [], text: t, page: line.page });
      return;
    }

    // Testo semplice senza nome di personaggio.
    if (c && c.kind === 'speech' && (!line.paragraphBreak || c.text === '')) {
      c.text = appendText(c.text, t);
      if (unknownName && !c.ambiguous) c.ambiguous = unknownName;
      trackParen(c);
      return;
    }
    if (c && c.kind === 'direction' && curIsClosedParen && lastSpeech) {
      lastSpeech = push({
        kind: 'speech',
        speakers: [...lastSpeech.speakers],
        text: t,
        page: line.page,
        ambiguous:
          unknownName ?? `Battuta senza nome dopo una didascalia: attribuita a ${speakerNames(lastSpeech.speakers)}`,
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

  const finalBlocks = separateInlineDirections(blocks);
  blocks.length = 0;
  blocks.push(...finalBlocks);
  for (const b of blocks) {
    if (b.kind === 'speech' && !b.text && !b.ambiguous) b.ambiguous = 'Battuta senza testo';
  }

  const speechCount = blocks.filter((b) => b.kind === 'speech').length;
  const stats: ParseStats = {
    lines: lines.length,
    pages: new Set(lines.map((l) => l.page)).size,
    speeches: speechCount,
    formats,
    unattributed: blocks.filter((b) => b.kind === 'direction' && b.ambiguous).length,
  };

  const now = opts.now ?? Date.now();
  const warnings: string[] = [];
  if (characters.length === 0) {
    warnings.push(
      'Nessun personaggio riconosciuto. Il formato del copione potrebbe non essere supportato: verifica e correggi manualmente.',
    );
  } else {
    const main = (Object.entries(formats) as [CueStyle, number][]).sort((a, b) => b[1] - a[1])[0];
    if (main && speechCount > 0) {
      warnings.push(
        `Formato delle battute riconosciuto: ${CUE_STYLE_LABEL[main[0]]} (${Math.round((main[1] / speechCount) * 100)}% delle battute).`,
      );
    }
  }
  const ambiguousCount = blocks.filter((b) => b.ambiguous).length;
  if (ambiguousCount > 0) warnings.push(`${ambiguousCount} passaggi da verificare.`);

  return {
    id: opts.id ?? `s${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title,
    fileName: opts.fileName,
    importedAt: now,
    updatedAt: now,
    characters,
    blocks,
    warnings,
    stats,
  };
}
