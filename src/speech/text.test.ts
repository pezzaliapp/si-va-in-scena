import { describe, expect, it } from 'vitest';
import { chunkText, speakableText } from './text';

describe('testo da leggere', () => {
  it('esclude le didascalie tra parentesi', () => {
    expect(speakableText('Aspetta (ride) no, scherzavo [pausa] .')).toBe('Aspetta no, scherzavo.');
    expect(speakableText('(tra sé (piano)) Basta.')).toBe('Basta.');
  });
  it('una battuta fatta solo di didascalia non ha testo da leggere', () => {
    expect(speakableText('(Silenzio)')).toBe('');
  });
  it('divide il testo lungo in segmenti', () => {
    const long = 'Prima frase abbastanza lunga da stare da sola, davvero. ' + 'parola '.repeat(60) + 'fine.';
    const chunks = chunkText(long, 120);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' ').trim());
  });
  it('unisce le frasi brevi', () => {
    expect(chunkText('Sì. No. Forse.')).toEqual(['Sì. No. Forse.']);
  });
});
