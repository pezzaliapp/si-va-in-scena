import type { RawLine } from '../parser/lines';

/** Sottoinsieme dell'interfaccia di PDF.js usato per l'estrazione (facilita i test). */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
export interface PdfPageLike {
  getViewport(o: { scale: number }): {
    height: number;
    convertToViewportPoint(x: number, y: number): number[];
  };
  getTextContent(): Promise<{ items: unknown[] }>;
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
}

interface Positioned {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item;
}

/** Ricostruisce le righe di testo di ogni pagina a partire dagli elementi posizionati. */
export async function extractLines(doc: PdfDocLike, onProgress?: (page: number) => void): Promise<Extraction> {
  const lines: RawLine[] = [];
  const heights = new Map<RawLine, number>();
  let chars = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: Positioned[] = [];
    for (const it of content.items) {
      if (!isTextItem(it) || !it.str) continue;
      const [, , c = 0, d = 0, e = 0, f = 0] = it.transform;
      const [x = 0, y = 0] = viewport.convertToViewportPoint(e, f);
      const h = it.height || Math.hypot(c, d) || 10;
      items.push({ text: it.str, x, y, w: it.width, h });
      chars += it.str.trim().length;
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);

    const rows: Positioned[][] = [];
    for (const item of items) {
      const row = rows.at(-1);
      const ref = row?.[0];
      if (row && ref && Math.abs(item.y - ref.y) < Math.max(2, Math.min(item.h, ref.h) * 0.5)) row.push(item);
      else rows.push([item]);
    }

    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      let text = '';
      let end = -Infinity;
      let maxH = 0;
      for (const it of row) {
        const gap = it.x - end;
        if (text && gap > it.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.text)) text += ' ';
        text += it.text;
        end = it.x + it.w;
        maxH = Math.max(maxH, it.h);
      }
      const line: RawLine = { text, page: p, y: row[0]!.y, pageHeight: viewport.height };
      if (text.trim()) {
        lines.push(line);
        heights.set(line, maxH);
      }
    }
    onProgress?.(p);
  }

  // Titolo: le righe con il carattere più grande all'inizio della prima pagina.
  const firstLines = lines.filter((l) => l.page === 1).slice(0, 15);
  let titleHint: string | undefined;
  if (firstLines.length > 0) {
    const maxH = Math.max(...firstLines.map((l) => heights.get(l) ?? 0));
    const bodyH = median(lines.map((l) => heights.get(l) ?? 0));
    if (maxH > bodyH * 1.15) {
      titleHint = firstLines
        .filter((l) => (heights.get(l) ?? 0) >= maxH * 0.95)
        .map((l) => l.text.trim())
        .join(' ')
        .slice(0, 120);
    }
  }

  return {
    lines,
    titleHint,
    pageCount: doc.numPages,
    charsPerPage: doc.numPages > 0 ? chars / doc.numPages : 0,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Sotto questa soglia il PDF è probabilmente un'immagine scansionata senza testo. */
export const SCANNED_THRESHOLD = 40;
