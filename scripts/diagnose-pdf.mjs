#!/usr/bin/env node
// Diagnostica LOCALE della struttura di un PDF, senza mostrare il testo.
// Le lettere sono mascherate (a/A), le cifre diventano 9: si vedono solo
// forma delle righe, punteggiatura, posizioni e dimensioni dei caratteri.
// Uso: npm run diagnose -- percorso/del/copione.pdf [pagine]
// Nulla viene salvato o inviato: l'output appare solo nel terminale.
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, pagesArg = '1-3'] = process.argv.slice(2);
if (!file) {
  console.error('Uso: npm run diagnose -- copione.pdf [pagine, es. 1-3]');
  process.exit(1);
}
const [from, to = from] = pagesArg.split('-').map(Number);
const mask = (s) => s.replace(/\p{Lu}/gu, 'A').replace(/\p{Ll}/gu, 'a').replace(/\p{N}/gu, '9');
const r1 = (n) => Math.round(n * 10) / 10;

const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), disableFontFace: true, verbosity: 0 }).promise;
console.log(`Pagine: ${doc.numPages}`);
let totalItems = 0, totalEOL = 0, totalNewlineInStr = 0;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter((i) => 'str' in i);
  totalItems += items.length;
  totalEOL += items.filter((i) => i.hasEOL).length;
  totalNewlineInStr += items.filter((i) => i.str.includes('\n')).length;
  if (p < from || p > to) continue;
  const ys = new Set(items.map((i) => r1(vp.convertToViewportPoint(i.transform[4], i.transform[5])[1])));
  console.log(`\n=== pagina ${p}: ${items.length} elementi, ${ys.size} coordinate y distinte, rotazione ${vp.rotation}, altezza ${r1(vp.height)}`);
  for (const i of items.slice(0, 60)) {
    const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
    const font = tc.styles[i.fontName]?.fontFamily ?? '?';
    console.log(
      `x=${String(r1(x)).padStart(6)} y=${String(r1(y)).padStart(6)} h=${String(r1(i.height)).padStart(5)} w=${String(r1(i.width)).padStart(6)} tm=[${i.transform.map(r1).join(',')}] eol=${i.hasEOL ? 1 : 0} font=${i.fontName}/${font} | ${JSON.stringify(mask(i.str))}`,
    );
  }
}
console.log(`\nTotale elementi: ${totalItems}, con fine riga: ${totalEOL}, con "\\n" nel testo: ${totalNewlineInStr}`);
