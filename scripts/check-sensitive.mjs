#!/usr/bin/env node
// Controllo anti-fuga di copioni e documenti riservati.
// Esegue la verifica sui file in stage (pre-commit) oppure, con --all,
// su tutti i file tracciati. Esce con codice 1 se trova problemi.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const BLOCKED_EXT = /\.(pdf|doc|docx|odt|rtf|pages|epub|fdx|fountain|celtx|txt|key|pem|p12)$/i;
const BLOCKED_NAME = /(^|\/)(\.env(\..*)?|si-va-in-scena-backup.*\.json)$/i;
const MAX_BYTES = 1024 * 1024;
// Firme binarie di documenti: PDF, ZIP/Office/ODF, RTF, vecchio Word OLE.
const SIGNATURES = [
  { name: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46] },
  { name: 'RTF', bytes: [0x7b, 0x5c, 0x72, 0x74, 0x66] },
  { name: 'OLE (Word/Excel)', bytes: [0xd0, 0xcf, 0x11, 0xe0] },
  { name: 'ZIP/Office', bytes: [0x50, 0x4b, 0x03, 0x04] },
];
// File binari legittimi del progetto (icone).
const ALLOWED_BINARY = /^public\/icons\/[\w.-]+\.png$/;

const all = process.argv.includes('--all');
const args = all ? ['ls-files', '-z'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'];
const files = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);

const problems = [];
for (const file of files) {
  if (BLOCKED_EXT.test(file) || BLOCKED_NAME.test(file)) {
    problems.push(`${file}: tipo di file non ammesso (possibile documento riservato)`);
    continue;
  }
  let size;
  try {
    size = statSync(file).size;
  } catch {
    continue; // file rimosso dal working tree
  }
  if (size > MAX_BYTES) problems.push(`${file}: file troppo grande (${size} byte)`);
  const head = readFileSync(file).subarray(0, 8);
  for (const sig of SIGNATURES) {
    if (sig.bytes.every((b, i) => head[i] === b) && !ALLOWED_BINARY.test(file)) {
      problems.push(`${file}: contenuto ${sig.name} rilevato`);
    }
  }
}

if (problems.length > 0) {
  console.error('\n✖ SI VA IN SCENA — commit bloccato: possibili documenti riservati\n');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nI copioni non devono mai entrare nel repository.\n');
  process.exit(1);
}
console.log(`✓ Controllo documenti riservati superato (${files.length} file verificati).`);
