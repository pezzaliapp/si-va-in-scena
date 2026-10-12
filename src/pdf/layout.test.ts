// Test d'integrazione: genera in memoria un PDF con un dialogo originale
// (nessun file PDF nel repository) e lo analizza con PDF.js.
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { cleanLines } from '../parser/lines';
import { parseScript } from '../parser/parse';
import { extractLines, SCANNED_THRESHOLD } from './layout';

async function makePdf(pages: { size: number; text: string }[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const rows of pages) {
    const page = pdf.addPage([400, 600]);
    let y = 560;
    for (const r of rows) {
      if (r.text) page.drawText(r.text, { x: 40, y, size: r.size, font });
      y -= r.text ? r.size * 1.4 : 14;
    }
    page.drawText(String(pdf.getPageCount()), { x: 195, y: 20, size: 9, font });
  }
  return pdf.save();
}

async function load(data: Uint8Array) {
  return getDocument({ data, disableFontFace: true }).promise;
}

const body = (text: string) => ({ size: 11, text });

describe('estrazione da PDF', () => {
  it('ricostruisce titolo, righe e battute da un PDF reale', async () => {
    const data = await makePdf([
      [
        { size: 22, text: 'IL FARO DI NEBBIA' },
        body(''),
        body('ATTO PRIMO'),
        body('VERA: Hai acceso la luce del faro?'),
        body('GINO: Non ancora, la lampada'),
        body('si è rotta di nuovo.'),
        body('(Vera guarda il mare)'),
      ],
      [body('VERA: Allora stanotte nessuno ci vedrà.'), body('GINO: Le navi hanno la radio.'), body('VERA: Speriamo.')],
    ]);
    const doc = await load(data);
    const ex = await extractLines(doc);
    expect(ex.pageCount).toBe(2);
    expect(ex.titleHint).toBe('IL FARO DI NEBBIA');
    expect(ex.charsPerPage).toBeGreaterThan(SCANNED_THRESHOLD);

    const script = parseScript(cleanLines(ex.lines), { fileName: 'faro.pdf', title: ex.titleHint });
    expect(script.characters.map((c) => c.name)).toEqual(['VERA', 'GINO']);
    const speeches = script.blocks.filter((b) => b.kind === 'speech').map((b) => b.text);
    expect(speeches).toEqual([
      'Hai acceso la luce del faro?',
      'Non ancora, la lampada si è rotta di nuovo.',
      'Allora stanotte nessuno ci vedrà.',
      'Le navi hanno la radio.',
      'Speriamo.',
    ]);
    // Il numero di pagina non deve finire nelle battute.
    expect(script.blocks.some((b) => /^\d+$/.test(b.text))).toBe(false);
  });

  it('riconosce un PDF senza testo (scansione)', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 600]);
    const doc = await load(await pdf.save());
    const ex = await extractLines(doc);
    expect(ex.charsPerPage).toBeLessThan(SCANNED_THRESHOLD);
  });
});
