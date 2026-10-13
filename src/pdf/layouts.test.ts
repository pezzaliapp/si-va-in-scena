// Test d'integrazione sulle impaginazioni: ogni PDF è generato in memoria con un
// copione sintetico originale (nessun file nel repository) e poi analizzato con PDF.js.
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { cleanLines } from '../parser/lines';
import { parseScript } from '../parser/parse';
import { extractLines } from './layout';

const TITLE = 'IL GIARDINO DEI GATTI';
const CAST = ['MIRA', 'TEO', 'LA SIGNORA PONTI'];
const SENTENCES = [
  'Hai dato da mangiare ai gatti?',
  'Due volte, ma il rosso ne vuole ancora e continua a miagolare davanti alla porta della cucina.',
  'Non aprire il cancello, stanotte.',
  'Perché?',
  'Perché la luna è piena e loro diventano curiosi, lo sai benissimo anche tu, non fare finta di niente.',
  'Va bene.',
  'Domattina passo dal mercato e compro il pesce, così almeno per qualche giorno staranno tranquilli.',
];
const DIRECTIONS = ['Mira raccoglie una ciotola.', 'Si sente un miagolio lontano.'];

type Item = { name: string; text: string } | { direction: string } | { heading: string };

/** Copione deterministico: 60 battute, scene e didascalie. */
function makeScript(): Item[] {
  const items: Item[] = [];
  let prev = -1;
  for (let i = 0; i < 60; i++) {
    if (i % 20 === 0) items.push({ heading: `SCENA ${i / 20 + 1}` });
    if (i % 9 === 4) items.push({ direction: DIRECTIONS[i % 2]! });
    let who = (i * 7 + 3) % CAST.length;
    if (who === prev) who = (who + 1) % CAST.length;
    prev = who;
    items.push({ name: CAST[who]!, text: SENTENCES[(i * 5) % SENTENCES.length]! });
  }
  return items;
}

type Layout = 'column' | 'centered' | 'bold' | 'uppercaseSpace' | 'mixedColumn';

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

/** Impaginatore minimo: a capo automatico, intestazione e numero di pagina. */
class Typesetter {
  page!: PDFPage;
  y = 0;
  pages = 0;
  constructor(
    private pdf: PDFDocument,
    private f: Fonts,
    private size = 11,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.pdf.addPage([595, 842]);
    this.pages++;
    if (this.pages > 1) this.page.drawText(TITLE, { x: 400, y: 800, size: 8, font: this.f.italic });
    this.page.drawText(String(this.pages), { x: 292, y: 30, size: 9, font: this.f.regular });
    this.y = 770;
  }
  space(points: number) {
    this.y -= points;
  }
  /** Scrive un paragrafo a partire da x, andando a capo entro maxX. */
  para(text: string, x: number, font: PDFFont, maxX = 520, prefix?: { text: string; font: PDFFont; x: number }) {
    const words = text.split(' ');
    let line = '';
    let first = true;
    const flush = () => {
      if (this.y < 60) this.newPage();
      if (first && prefix) this.page.drawText(prefix.text, { x: prefix.x, y: this.y, size: this.size, font: prefix.font });
      this.page.drawText(line, { x, y: this.y, size: this.size, font });
      this.y -= this.size * 1.3;
      line = '';
      first = false;
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, this.size) > maxX - x && line) {
        flush();
        line = w;
      } else line = next;
    }
    if (line) flush();
  }
  centered(text: string, font: PDFFont, size = this.size) {
    if (this.y < 60) this.newPage();
    const w = font.widthOfTextAtSize(text, size);
    this.page.drawText(text, { x: (595 - w) / 2, y: this.y, size, font });
    this.y -= size * 1.3;
  }
}

async function buildPdf(layout: Layout, items: Item[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const f: Fonts = {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
  };
  const t = new Typesetter(pdf, f);
  // Frontespizio e crediti.
  t.space(200);
  t.centered(TITLE, f.bold, 24);
  t.space(10);
  t.centered('Commedia in un atto di Autrice Immaginaria', f.regular);
  t.centered('Copione di prova per i test', f.regular);
  t.newPage();
  // Elenco dei personaggi.
  t.para('PERSONAGGI', 72, f.bold);
  for (const n of CAST) t.para(`${n}, abitante del quartiere`, 72, f.regular);
  t.newPage();

  const cap = (n: string) => n.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
  for (const it of items) {
    if ('heading' in it) {
      t.space(8);
      t.centered(it.heading, f.bold);
      t.space(4);
    } else if ('direction' in it) {
      t.space(4);
      if (layout === 'centered') t.para(`(${it.direction})`, 140, f.regular, 455);
      else t.para(it.direction, 190, f.italic);
    } else if (layout === 'column') {
      t.space(4);
      t.para(it.text, 190, f.regular, 520, { text: it.name, font: f.regular, x: 72 });
    } else if (layout === 'mixedColumn') {
      t.space(4);
      t.para(it.text, 190, f.regular, 520, { text: cap(it.name), font: f.regular, x: 72 });
    } else if (layout === 'centered') {
      t.space(8);
      t.centered(it.name, f.regular);
      t.para(it.text, 140, f.regular, 455);
    } else {
      t.space(4);
      const font = layout === 'bold' ? f.bold : f.regular;
      const nameW = font.widthOfTextAtSize(it.name + ' ', 11);
      t.para(it.text, 72 + nameW, f.regular, 520, { text: it.name, font, x: 72 });
    }
  }
  return pdf.save();
}

async function analyse(data: Uint8Array) {
  const doc = await getDocument({ data, disableFontFace: true, fontExtraProperties: true, verbosity: 0 }).promise;
  const ex = await extractLines(doc);
  return parseScript(cleanLines(ex.lines), { fileName: 'giardino.pdf', title: ex.titleHint });
}

describe.each<Layout>(['column', 'centered', 'bold', 'uppercaseSpace', 'mixedColumn'])(
  'impaginazione "%s"',
  (layout) => {
    const items = makeScript();
    const expected = items.filter((i): i is { name: string; text: string } => 'name' in i);

    it('riconosce titolo, crediti, personaggi e battute', async () => {
      const s = await analyse(await buildPdf(layout, items));
      const upper = (id: string) => s.characters.find((c) => c.id === id)!.name.toUpperCase();

      expect(s.title).toBe(TITLE);
      expect(s.characters.map((c) => c.name.toUpperCase()).sort()).toEqual([...CAST].sort());
      expect(s.blocks[0]!.kind).toBe('front');
      expect(s.blocks.some((b) => b.kind === 'cast')).toBe(true);

      const speeches = s.blocks.filter((b) => b.kind === 'speech');
      expect(speeches.map((b) => `${b.speakers.map(upper).join()}: ${b.text}`)).toEqual(
        expected.map((e) => `${e.name}: ${e.text}`),
      );
      expect(s.blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual(['SCENA 1', 'SCENA 2', 'SCENA 3']);
      expect(s.blocks.filter((b) => b.kind === 'direction')).toHaveLength(
        items.filter((i) => 'direction' in i).length,
      );
      // Il titolo ripetuto in testa alle pagine non diventa un personaggio né un passaggio da verificare.
      expect(s.blocks.filter((b) => b.ambiguous)).toEqual([]);
    });
  },
);

describe('browser senza iterazione asincrona dei ReadableStream (Safari)', () => {
  it('estrae lo stesso copione', async () => {
    const data = await buildPdf('column', makeScript());
    const expected = await analyse(data.slice());
    const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
    const original = proto[Symbol.asyncIterator];
    delete proto[Symbol.asyncIterator];
    try {
      const s = await analyse(data.slice());
      expect(s.blocks).toEqual(expected.blocks);
      expect(s.characters).toEqual(expected.characters);
    } finally {
      proto[Symbol.asyncIterator] = original;
    }
  });
});
