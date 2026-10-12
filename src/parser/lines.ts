/** Riga di testo così come ricostruita dall'impaginazione del PDF. */
export interface RawLine {
  text: string;
  page: number;
  /** Distanza dal bordo superiore della pagina (stesse unità di pageHeight). */
  y: number;
  pageHeight: number;
}

/** Riga pulita, pronta per l'analisi del copione. */
export interface Line {
  text: string;
  page: number;
  /** Vero se prima della riga c'è uno spazio verticale maggiore dell'interlinea normale. */
  paragraphBreak: boolean;
}

const MARGIN = 0.1;
const PAGE_NUMBER = /^(?:[-–—]\s*)?(?:pag(?:ina|\.)?\s*)?\d{1,4}(?:\s*(?:\/|di|of)\s*\d{1,4})?(?:\s*[-–—])?$/i;

function inMargin(l: RawLine): boolean {
  return l.y < l.pageHeight * MARGIN || l.y > l.pageHeight * (1 - MARGIN);
}

function normalizeRepeated(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/**
 * Rimuove numeri di pagina, intestazioni e piè di pagina ripetuti e
 * segna le interruzioni di paragrafo in base allo spazio verticale.
 */
export function cleanLines(raw: RawLine[]): Line[] {
  const lines = raw
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0);

  const pageCount = new Set(lines.map((l) => l.page)).size;
  const pagesByText = new Map<string, Set<number>>();
  for (const l of lines) {
    if (!inMargin(l)) continue;
    const key = normalizeRepeated(l.text);
    const pages = pagesByText.get(key) ?? new Set<number>();
    pages.add(l.page);
    pagesByText.set(key, pages);
  }
  const repeatedThreshold = Math.max(3, Math.ceil(pageCount * 0.3));

  const kept = lines.filter((l) => {
    if (!inMargin(l)) return true;
    if (PAGE_NUMBER.test(l.text)) return false;
    const pages = pagesByText.get(normalizeRepeated(l.text));
    return !(pages && pages.size >= repeatedThreshold);
  });

  const gaps: number[] = [];
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1]!;
    const b = kept[i]!;
    if (a.page === b.page && b.y > a.y) gaps.push(b.y - a.y);
  }
  gaps.sort((x, y) => x - y);
  const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : 0;

  return kept.map((l, i) => {
    const prev = i > 0 ? kept[i - 1] : undefined;
    const paragraphBreak =
      !!prev && prev.page === l.page && median > 0 && l.y - prev.y > median * 1.5;
    return { text: l.text, page: l.page, paragraphBreak };
  });
}

/** Converte testo semplice in righe: una riga vuota indica un nuovo paragrafo. */
export function linesFromText(text: string, page = 1): Line[] {
  const out: Line[] = [];
  let pendingBreak = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const t = rawLine.replace(/\s+/g, ' ').trim();
    if (!t) {
      pendingBreak = out.length > 0;
      continue;
    }
    out.push({ text: t, page, paragraphBreak: pendingBreak });
    pendingBreak = false;
  }
  return out;
}
