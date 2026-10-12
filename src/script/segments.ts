/** Parte di una battuta: testo da pronunciare oppure didascalia interna. */
export interface Segment {
  kind: 'spoken' | 'direction';
  text: string;
  /** Didascalia aperta e mai chiusa nel testo della battuta. */
  unclosed?: boolean;
}

/**
 * Divide il testo di una battuta in parti pronunciate e didascalie tra
 * parentesi tonde o quadre (anche annidate). Concatenando i segmenti si
 * ottiene il testo originale, a meno degli spazi.
 */
export function segmentSpeech(text: string): Segment[] {
  const out: Segment[] = [];
  let depth = 0;
  let buf = '';
  const flush = (kind: Segment['kind'], unclosed = false) => {
    const t = buf.replace(/\s+/g, ' ').trim();
    if (t) out.push(unclosed ? { kind, text: t, unclosed } : { kind, text: t });
    buf = '';
  };
  for (const ch of text) {
    if (ch === '(' || ch === '[') {
      if (depth === 0) flush('spoken');
      depth++;
      buf += ch;
    } else if ((ch === ')' || ch === ']') && depth > 0) {
      buf += ch;
      depth--;
      if (depth === 0) flush('direction');
    } else buf += ch;
  }
  flush(depth > 0 ? 'direction' : 'spoken', depth > 0);
  return out;
}

/** Testo da pronunciare: le didascalie interne sono escluse. */
export function spokenText(text: string): string {
  return segmentSpeech(text)
    .filter((s) => s.kind === 'spoken')
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
