/** Rimuove le didascalie tra parentesi: non vanno lette ad alta voce. */
export function speakableText(text: string): string {
  let out = text;
  let prev;
  do {
    prev = out;
    out = out.replace(/\([^()]*\)|\[[^[\]]*\]/g, ' ');
  } while (out !== prev);
  return out.replace(/\s+([,.;:!?…])/g, '$1').replace(/\s+/g, ' ').trim();
}

/**
 * Divide il testo in frasi brevi. Alcuni browser interrompono le
 * enunciazioni lunghe e la pausa è più precisa su segmenti corti.
 */
export function chunkText(text: string, max = 180): string[] {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["»”’)]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    let s = sentence;
    while (s.length > max) {
      const cut = Math.max(s.lastIndexOf(',', max), s.lastIndexOf(';', max), s.lastIndexOf(' ', max));
      const at = cut > max / 3 ? cut + 1 : max;
      chunks.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    const last = chunks.at(-1);
    if (last && last.length + s.length + 1 <= max && s.length < 40) chunks[chunks.length - 1] = `${last} ${s}`;
    else if (s) chunks.push(s);
  }
  return chunks;
}
