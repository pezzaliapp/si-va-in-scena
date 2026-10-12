/** Porzione di riga con stile uniforme. `gapBefore` indica uno spazio ampio (tabulazione o colonna). */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  gapBefore?: boolean;
}

/** Riga di testo così come ricostruita dall'impaginazione del PDF. */
export interface RawLine {
  /** Testo della riga; gli spazi ampi tra colonne sono resi con "\t". */
  text: string;
  page: number;
  /** Distanza dal bordo superiore della pagina (stesse unità di pageHeight). */
  y: number;
  pageHeight: number;
  pageWidth?: number;
  x?: number;
  right?: number;
  /** Altezza del carattere. */
  size?: number;
  runs?: Run[];
}

/** Riga pulita, pronta per l'analisi del copione. */
export interface Line {
  text: string;
  page: number;
  /** Vero se prima della riga c'è uno spazio verticale maggiore dell'interlinea normale. */
  paragraphBreak: boolean;
  runs?: Run[];
  /** Rientro sinistro come frazione della larghezza della pagina. */
  indent?: number;
  /** Dimensione del carattere rispetto al testo normale del documento (1 = normale). */
  size?: number;
  centered?: boolean;
  /** Tutta la riga è in grassetto / in corsivo (undefined = stile sconosciuto). */
  bold?: boolean;
  italic?: boolean;
}

const MARGIN = 0.1;
const PAGE_NUMBER =
  /^(?:[-–—]\s*)?(?:pag(?:ina|\.)?\s*)?\d{1,4}(?:\s*(?:\/|di|of)\s*\d{1,4})?(?:\s*[-–—])?$/i;

function inMargin(l: RawLine): boolean {
  return l.y < l.pageHeight * MARGIN || l.y > l.pageHeight * (1 - MARGIN);
}

function normalizeRepeated(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * Rimuove numeri di pagina, intestazioni e piè di pagina ripetuti, segna le
 * interruzioni di paragrafo e calcola rientro, dimensione e stile delle righe.
 */
export function cleanLines(raw: RawLine[]): Line[] {
  const lines = raw
    .map((l) => ({ ...l, text: l.text.replace(/[ \u00a0]+/g, ' ').replace(/ ?\t ?/g, '\t').trim() }))
    .filter((l) => l.text.length > 0);

  // Intestazioni e piè di pagina: stesso testo, nella stessa posizione, su molte pagine.
  const pageCount = new Set(lines.map((l) => l.page)).size;
  // Nei margini basta una ripetizione su un terzo delle pagine; nel corpo serve molto di più,
  // per non scambiare battute brevi e ricorrenti per intestazioni.
  const marginThreshold = Math.max(3, Math.ceil(pageCount * 0.3));
  const bodyThreshold = Math.max(5, Math.ceil(pageCount * 0.6));
  const byText = new Map<string, RawLine[]>();
  for (const l of lines) {
    const key = normalizeRepeated(l.text);
    const list = byText.get(key) ?? [];
    list.push(l);
    byText.set(key, list);
  }
  const repeated = new Set<RawLine>();
  for (const list of byText.values()) {
    const pages = new Set(list.map((l) => l.page));
    if (pages.size < marginThreshold) continue;
    // Raggruppa le occorrenze per posizione verticale simile (rispetto alla prima del gruppo).
    const sorted = [...list].sort((a, b) => a.y / a.pageHeight - b.y / b.pageHeight);
    let group: RawLine[] = [];
    const flush = () => {
      const groupPages = new Set(group.map((l) => l.page)).size;
      const needed = group.every(inMargin) ? marginThreshold : bodyThreshold;
      // Un'intestazione compare (quasi) una volta per pagina.
      if (groupPages >= needed && group.length <= groupPages * 1.2) group.forEach((l) => repeated.add(l));
      group = [];
    };
    for (const l of sorted) {
      const first = group[0];
      if (first && l.y / l.pageHeight - first.y / first.pageHeight > 0.015) flush();
      group.push(l);
    }
    flush();
  }

  const kept = lines.filter((l) => !repeated.has(l) && !(inMargin(l) && PAGE_NUMBER.test(l.text)));

  const gaps: number[] = [];
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1]!;
    const b = kept[i]!;
    if (a.page === b.page && b.y > a.y) gaps.push(b.y - a.y);
  }
  const lineGap = median(gaps);
  // Dimensione del testo normale: mediana pesata sul numero di caratteri.
  const sizes: number[] = [];
  for (const l of kept) if (l.size) for (let i = 0; i < Math.min(l.text.length, 200); i += 10) sizes.push(l.size);
  const bodySize = median(sizes);

  return kept.map((l, i) => {
    const prev = i > 0 ? kept[i - 1] : undefined;
    const paragraphBreak = !!prev && prev.page === l.page && lineGap > 0 && l.y - prev.y > lineGap * 1.5;
    const out: Line = { text: l.text, page: l.page, paragraphBreak };
    if (l.runs) {
      out.runs = l.runs;
      const styled = l.runs.filter((r) => r.text.trim());
      if (styled.length > 0) {
        out.bold = styled.every((r) => r.bold);
        out.italic = styled.every((r) => r.italic);
      }
    }
    if (l.pageWidth && l.x !== undefined) {
      out.indent = l.x / l.pageWidth;
      if (l.right !== undefined) {
        const center = (l.x + l.right) / 2;
        out.centered = Math.abs(center - l.pageWidth / 2) < l.pageWidth * 0.04 && out.indent > 0.2;
      }
    }
    if (l.size && bodySize) out.size = l.size / bodySize;
    return out;
  });
}

/**
 * Converte testo semplice in righe: una riga vuota indica un nuovo paragrafo,
 * il carattere di tabulazione uno spazio ampio tra colonne.
 */
export function linesFromText(text: string, page = 1): Line[] {
  const out: Line[] = [];
  let pendingBreak = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const t = rawLine.replace(/[ \u00a0]+/g, ' ').replace(/ ?\t+ ?/g, '\t').trim();
    if (!t) {
      pendingBreak = out.length > 0;
      continue;
    }
    out.push({ text: t, page, paragraphBreak: pendingBreak });
    pendingBreak = false;
  }
  return out;
}
