import type { RawLine, Run } from '../parser/lines';

/** Sottoinsieme dell'interfaccia di PDF.js usato per l'estrazione (facilita i test). */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}
export interface PdfPageLike {
  getViewport(o: { scale: number }): {
    width: number;
    height: number;
    convertToViewportPoint(x: number, y: number): number[];
  };
  getTextContent(): Promise<{ items: unknown[] }>;
  /** Carica i font della pagina: serve a conoscerne il nome (grassetto/corsivo). */
  getOperatorList?(): Promise<unknown>;
  commonObjs?: { get(id: string): unknown };
}
export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

export interface Extraction {
  lines: RawLine[];
  titleHint?: string;
  pageCount: number;
  /** Caratteri di testo per pagina: valori molto bassi indicano un PDF scansionato. */
  charsPerPage: number;
  /** Vero se è stato possibile leggere lo stile dei caratteri (grassetto/corsivo). */
  stylesKnown: boolean;
}

interface Positioned {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bold?: boolean;
  italic?: boolean;
}

interface FontStyle {
  bold?: boolean;
  italic?: boolean;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item;
}

const BOLD = /bold|black|heavy|semibold|demibold|grassetto|-bd\b|,b\b/i;
const ITALIC = /italic|oblique|corsivo|-it\b|,i\b/i;

/** Stile del font dedotto dal suo nome (es. "ABCDEF+TimesNewRomanPS-BoldItalicMT"). */
async function fontStyles(page: PdfPageLike, names: Set<string>): Promise<Map<string, FontStyle> | null> {
  if (!page.getOperatorList || !page.commonObjs) return null;
  try {
    await page.getOperatorList();
  } catch {
    return null;
  }
  const map = new Map<string, FontStyle>();
  for (const id of names) {
    try {
      const font = page.commonObjs.get(id) as { name?: unknown } | undefined;
      const name = typeof font?.name === 'string' ? font.name : '';
      if (name) map.set(id, { bold: BOLD.test(name), italic: ITALIC.test(name) });
    } catch {
      // font non disponibile: stile sconosciuto
    }
  }
  return map.size > 0 ? map : null;
}

/**
 * Ricostruisce le righe di ogni pagina dagli elementi posizionati di PDF.js,
 * conservando la geometria (rientro, dimensione, spazi ampi tra colonne)
 * e lo stile (grassetto/corsivo) quando disponibile.
 */
export async function extractLines(doc: PdfDocLike, onProgress?: (page: number) => void): Promise<Extraction> {
  const lines: RawLine[] = [];
  let chars = 0;
  let stylesKnown = false;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const textItems = content.items.filter(isTextItem);
    const styles = await fontStyles(page, new Set(textItems.map((i) => i.fontName ?? '').filter(Boolean)));
    if (styles) stylesKnown = true;

    const items: Positioned[] = [];
    for (const it of textItems) {
      // Gli elementi vuoti o di soli spazi non servono: lo spazio si deduce dalle posizioni.
      if (!it.str || !it.str.trim()) continue;
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = it.transform;
      const [x = 0, y = 0] = viewport.convertToViewportPoint(e, f);
      const h = Math.abs(it.height) || Math.hypot(c, d) || 10;
      const style = it.fontName ? styles?.get(it.fontName) : undefined;
      // Corsivo simulato: matrice inclinata.
      const skewed = Math.abs(c) > 0.1 * Math.abs(d) && Math.abs(b) < 0.01 * Math.abs(a);
      items.push({
        text: it.str,
        x,
        y,
        w: Math.abs(it.width),
        h,
        bold: style?.bold,
        italic: style?.italic || skewed || undefined,
      });
      chars += it.str.trim().length;
    }
    items.sort((m, n) => m.y - n.y || m.x - n.x);

    // Raggruppa per linea di base.
    const rows: Positioned[][] = [];
    for (const item of items) {
      const row = rows.at(-1);
      const ref = row?.[0];
      if (row && ref && Math.abs(item.y - ref.y) < Math.max(2, Math.min(item.h, ref.h) * 0.5)) row.push(item);
      else rows.push([item]);
    }

    for (const row of rows) {
      row.sort((m, n) => m.x - n.x);
      const size = Math.max(...row.map((i) => i.h));
      const runs: Run[] = [];
      let end = -Infinity;
      for (const it of row) {
        const gap = it.x - end;
        const wide = runs.length > 0 && gap > size * 1.2;
        const last = runs.at(-1);
        const sameStyle = last && !!last.bold === !!it.bold && !!last.italic === !!it.italic;
        if (last && sameStyle && !wide) {
          if (gap > size * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(it.text)) last.text += ' ';
          last.text += it.text;
        } else {
          const needsSpace = last && !wide && gap > size * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(it.text);
          runs.push({
            text: needsSpace ? ' ' + it.text : it.text,
            ...(it.bold ? { bold: true } : {}),
            ...(it.italic ? { italic: true } : {}),
            ...(wide ? { gapBefore: true } : {}),
          });
        }
        end = Math.max(end, it.x + it.w);
      }
      const text = runs
        .map((r) => (r.gapBefore ? '\t' : '') + r.text)
        .join('')
        .replace(/[ \u00a0]+/g, ' ')
        .trim();
      if (!text) continue;
      lines.push({
        text,
        page: p,
        y: row[0]!.y,
        x: row[0]!.x,
        right: end,
        size,
        pageHeight: viewport.height,
        pageWidth: viewport.width,
        runs,
      });
    }
    onProgress?.(p);
  }

  return {
    lines,
    titleHint: findTitle(lines),
    pageCount: doc.numPages,
    charsPerPage: doc.numPages > 0 ? chars / doc.numPages : 0,
    stylesKnown,
  };
}

/** Titolo: le righe con il carattere più grande all'inizio del documento. */
function findTitle(lines: RawLine[]): string | undefined {
  const first = lines.filter((l) => l.page <= 2).slice(0, 25);
  if (first.length === 0) return undefined;
  const body = median(lines.map((l) => l.size ?? 0));
  const maxH = Math.max(...first.map((l) => l.size ?? 0));
  if (!(maxH > body * 1.15)) return undefined;
  const idx = first.findIndex((l) => (l.size ?? 0) >= maxH * 0.95);
  const parts: string[] = [];
  for (let i = idx; i < first.length && (first[i]!.size ?? 0) >= maxH * 0.95; i++) parts.push(first[i]!.text.trim());
  return parts.join(' ').replace(/\t/g, ' ').slice(0, 120) || undefined;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Sotto questa soglia il PDF è probabilmente un'immagine scansionata senza testo. */
export const SCANNED_THRESHOLD = 40;
