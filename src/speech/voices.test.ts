import { describe, expect, it } from 'vitest';
import { autoAssign, resolveVoice, usableVoices, type VoiceInfo } from './voices';

const V: VoiceInfo[] = [
  { uri: 'it-a', name: 'Alice', lang: 'it-IT', local: true },
  { uri: 'it-b', name: 'Luca', lang: 'it-IT', local: true },
  { uri: 'it-net', name: 'Rete italiano', lang: 'it-IT', local: false },
  { uri: 'en-a', name: 'Daniel', lang: 'en-GB', local: true },
];
const chars = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: `p${i + 1}`, name: n }));

describe('voci', () => {
  it('in privacy rigorosa esclude le voci remote', () => {
    expect(usableVoices(V, true).map((v) => v.uri)).toEqual(['it-a', 'it-b', 'en-a']);
  });

  it('assegna voci diverse nella lingua del copione, escluso l’attore', () => {
    const local = usableVoices(V, true);
    const { voices, shared } = autoAssign(chars.slice(0, 3), 'p1', local, 'it');
    expect(voices.p1).toBeUndefined();
    expect([voices.p2?.voiceURI, voices.p3?.voiceURI]).toEqual(['it-a', 'it-b']);
    expect(shared).toBe(false);
  });

  it('se le voci non bastano le riusa variando l’intonazione e lo dichiara', () => {
    const { voices, shared } = autoAssign(chars, null, usableVoices(V, true), 'it');
    expect(shared).toBe(true);
    expect(voices.p3?.voiceURI).toBe('it-a');
    expect(voices.p3?.pitch).not.toBe(voices.p1?.pitch);
  });

  it('non usa una voce remota in privacy rigorosa', () => {
    const r = resolveVoice({ voiceURI: 'it-net', rate: 1.2, pitch: 1 }, V, true, 'it');
    expect(r).toEqual({ voiceURI: 'it-a', rate: 1.2, pitch: 1 });
  });

  it('senza voci locali in privacy rigorosa non legge', () => {
    expect(resolveVoice(undefined, [V[2]!], true, 'it')).toBeNull();
    expect(resolveVoice(undefined, [V[2]!], false, 'it')?.voiceURI).toBe('it-net');
  });
});
