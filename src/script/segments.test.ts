// Frasi originali scritte per i test.
import { describe, expect, it } from 'vitest';
import { segmentSpeech, spokenText } from './segments';

describe('segmentazione delle battute', () => {
  it('separa parti pronunciate e didascalie interne', () => {
    expect(segmentSpeech('(chiama) Papà! (pausa) Sei in casa?')).toEqual([
      { kind: 'direction', text: '(chiama)' },
      { kind: 'spoken', text: 'Papà!' },
      { kind: 'direction', text: '(pausa)' },
      { kind: 'spoken', text: 'Sei in casa?' },
    ]);
  });

  it('gestisce parentesi annidate e quadre', () => {
    expect(spokenText('Basta (tra sé (piano)) davvero [esce].')).toBe('Basta davvero.');
  });

  it('segnala una didascalia non chiusa senza pronunciarla', () => {
    expect(segmentSpeech('Vieni! (Entra lentamente')).toEqual([
      { kind: 'spoken', text: 'Vieni!' },
      { kind: 'direction', text: '(Entra lentamente', unclosed: true },
    ]);
    expect(spokenText('Vieni! (Entra lentamente')).toBe('Vieni!');
  });

  it('una battuta di sola didascalia non ha testo da pronunciare', () => {
    expect(spokenText('(Silenzio)')).toBe('');
  });

  it('non perde testo', () => {
    const t = 'Uno (a) due [b] tre (c (d)) quattro';
    expect(segmentSpeech(t).map((s) => s.text).join(' ')).toBe(t);
  });
});
