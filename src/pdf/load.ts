import { getDocument, GlobalWorkerOptions, InvalidPDFException, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { cleanLines } from '../parser/lines';
import { parseScript } from '../parser/parse';
import type { Script } from '../types';
import { extractLines, SCANNED_THRESHOLD } from './layout';

// Il worker è servito dall'app stessa: nessuna risorsa esterna.
GlobalWorkerOptions.workerSrc = workerUrl;

/** Problema del file (non valido, protetto, scansionato): non dell'app. */
export class ImportError extends Error {}

/** Legge un PDF interamente sul dispositivo e ne ricava il copione. */
export async function importPdf(file: File, onProgress?: (page: number, total: number) => void): Promise<Script> {
  const data = new Uint8Array(await file.arrayBuffer());
  // Altri errori (worker, risorse dell'app, estrazione) sono problemi tecnici e vengono propagati.
  const task = getDocument({
    data,
    disableFontFace: true,
    // Conserva il nome dei font per riconoscere grassetto e corsivo.
    fontExtraProperties: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err instanceof PasswordException) {
      throw new ImportError('Il PDF è protetto da password. Rimuovi la protezione e riprova.');
    }
    if (err instanceof InvalidPDFException) {
      throw new ImportError('Il file non sembra un PDF valido o è danneggiato.');
    }
    throw err;
  }
  try {
    const ex = await extractLines(doc, (p) => onProgress?.(p, doc.numPages));
    if (ex.charsPerPage < SCANNED_THRESHOLD) {
      throw new ImportError(
        'Questo PDF non contiene testo selezionabile: probabilmente è una scansione. ' +
          'Al momento sono supportati solo PDF con testo estraibile (ad esempio esportati da Word o simili).',
      );
    }
    return parseScript(cleanLines(ex.lines), { fileName: file.name, title: ex.titleHint });
  } finally {
    void task.destroy();
  }
}
