// Copione sintetico originale con nomi errati simili a quelli che un PDF può contenere.
import { describe, expect, it } from 'vitest';
import { linesFromText } from '../parser/lines';
import { parseScript } from '../parser/parse';
import { defaultSettings } from '../types';
import { lineCounts, mergeCharacters } from './edit';
import { editDistance, mergeSettings, normalizeName, suggestMerges } from './similar';

const rep = (name: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${name}: Battuta numero ${i + 1} di ${name.toLowerCase()}.`).join('\n');

const SCRIPT = parseScript(
  linesFromText(`
ATTO I
${rep('WALTER', 6)}
${rep('CARLA', 5)}
${rep('ALICE', 8)}
${rep('MARIO', 4)}
${rep('MARIA', 4)}
WAI.TER: Ho sbagliato strada, scusate.
CARIA: Chi ha suonato alla porta?
AUCE: Mamma, vieni a vedere!
AIACE: Non toccate niente.
POSTINO: Una raccomandata per voi.
MARIE: Arrivo subito.
`),
  { fileName: 'sintetico.pdf' },
);
const id = (name: string) => SCRIPT.characters.find((c) => c.name === name)!.id;
const names = (ids: string[]) => ids.map((i) => SCRIPT.characters.find((c) => c.id === i)!.name);

describe('suggerimenti di unione', () => {
  const s = suggestMerges(SCRIPT);
  const forName = (n: string) => s.find((x) => x.fromId === id(n));

  it('normalizza e misura la distanza tra i nomi', () => {
    expect(normalizeName('Wai.ter')).toBe('WAITER');
    expect(editDistance('WAITER', 'WALTER')).toBe(1);
    expect(editDistance('AUCE', 'ALICE')).toBe(2);
    expect(editDistance('AIACE', 'ALICE')).toBe(2);
    expect(editDistance('CARIA', 'CARLA')).toBe(1);
  });

  it('propone le corrispondenze per i nomi probabilmente errati', () => {
    expect(names(forName('WAI.TER')!.intoIds)).toEqual(['WALTER']);
    expect(names(forName('CARIA')!.intoIds)).toEqual(['CARLA']);
    expect(names(forName('AUCE')!.intoIds)).toEqual(['ALICE']);
    expect(names(forName('AIACE')!.intoIds)).toEqual(['ALICE']);
  });

  it('non propone nulla per personaggi frequenti o senza un nome simile', () => {
    expect(forName('MARIO')).toBeUndefined();
    expect(forName('MARIA')).toBeUndefined();
    expect(forName('POSTINO')).toBeUndefined();
    expect(forName('WALTER')).toBeUndefined();
  });

  it('in caso di parità propone tutti i candidati senza sceglierne uno', () => {
    expect(names(forName('MARIE')!.intoIds).sort()).toEqual(['MARIA', 'MARIO']);
  });

  it('un suggerimento rifiutato non ricompare', () => {
    expect(suggestMerges(SCRIPT, [id('CARIA')]).some((x) => x.fromId === id('CARIA'))).toBe(false);
  });
});

describe('unione', () => {
  it('conserva tutte le battute e i conteggi, e toglie l’avviso di battuta singola', () => {
    const merged = mergeCharacters(SCRIPT, id('AUCE'), id('ALICE'));
    const before = lineCounts(SCRIPT);
    const after = lineCounts(merged);
    expect(after.get(id('ALICE'))).toBe(before.get(id('ALICE'))! + before.get(id('AUCE'))!);
    expect(merged.blocks.map((b) => b.text)).toEqual(SCRIPT.blocks.map((b) => b.text));
    const line = merged.blocks.find((b) => b.text === 'Mamma, vieni a vedere!')!;
    expect(line.speakers).toEqual([id('ALICE')]);
    expect(line.ambiguous).toBeUndefined();
    expect(merged.characters.some((c) => c.name === 'AUCE')).toBe(false);
  });

  it('il ruolo passa al personaggio unito e la voce si conserva', () => {
    const st = {
      ...defaultSettings(SCRIPT.id),
      role: id('CARIA'),
      voices: { [id('CARIA')]: { voiceURI: 'v1', rate: 1, pitch: 1 } },
    };
    const o = mergeSettings(st, id('CARIA'), id('CARLA'));
    expect(o.voiceConflict).toBe(false);
    expect(o.settings.role).toBe(id('CARLA'));
    expect(o.settings.voices).toEqual({ [id('CARLA')]: { voiceURI: 'v1', rate: 1, pitch: 1 } });
  });

  it('se entrambi hanno voci diverse segnala il conflitto e non sovrascrive senza scelta', () => {
    const st = {
      ...defaultSettings(SCRIPT.id),
      voices: {
        [id('AUCE')]: { voiceURI: 'v1', rate: 1, pitch: 1 },
        [id('ALICE')]: { voiceURI: 'v2', rate: 1.1, pitch: 1 },
      },
    };
    const keepInto = mergeSettings(st, id('AUCE'), id('ALICE'));
    expect(keepInto.voiceConflict).toBe(true);
    expect(keepInto.settings.voices[id('ALICE')]!.voiceURI).toBe('v2');
    const keepFrom = mergeSettings(st, id('AUCE'), id('ALICE'), 'from');
    expect(keepFrom.settings.voices[id('ALICE')]!.voiceURI).toBe('v1');
    expect(keepFrom.settings.voices[id('AUCE')]).toBeUndefined();
  });
});

// Sette personaggi con battute inventate e quattro nomi letti male, in proporzioni diverse.
const CAST = parseScript(
  linesFromText(`
ATTO I
${rep('WALTER', 14)}
${rep('MARIO', 12)}
${rep('CARLA', 10)}
${rep('BARBARA', 9)}
${rep('GIACOMO', 8)}
${rep('ALICE', 16)}
${rep('NONNO', 5)}
${rep('WAI.TER', 3)}
${rep('AUCE', 2)}
AIACE: Chi ha lasciato la finestra aperta?
CARIA: Torno fra cinque minuti.
`),
  { fileName: 'sette.pdf' },
);
const cid = (name: string) => CAST.characters.find((c) => c.name === name)!.id;

describe('sette personaggi e quattro nomi errati', () => {
  it('propone esattamente le quattro unioni, anche per un nome errato con tre battute', () => {
    const s = suggestMerges(CAST);
    const pairs = s.map(
      (x) =>
        `${CAST.characters.find((c) => c.id === x.fromId)!.name}→${x.intoIds.map((i) => CAST.characters.find((c) => c.id === i)!.name).join('|')}`,
    );
    expect(pairs.sort()).toEqual(['AIACE→ALICE', 'AUCE→ALICE', 'CARIA→CARLA', 'WAI.TER→WALTER']);
  });

  it('confermate le unioni restano sette personaggi con tutte le battute', () => {
    let s = CAST;
    for (const [from, into] of [
      ['WAI.TER', 'WALTER'],
      ['AUCE', 'ALICE'],
      ['AIACE', 'ALICE'],
      ['CARIA', 'CARLA'],
    ]) {
      s = mergeCharacters(s, cid(from!), cid(into!));
    }
    expect(s.characters.map((c) => c.name).sort()).toEqual(
      ['ALICE', 'BARBARA', 'CARLA', 'GIACOMO', 'MARIO', 'NONNO', 'WALTER'].sort(),
    );
    const c = lineCounts(s);
    expect(c.get(cid('WALTER'))).toBe(17);
    expect(c.get(cid('ALICE'))).toBe(19);
    expect(c.get(cid('CARLA'))).toBe(11);
    expect(s.blocks.map((b) => b.text)).toEqual(CAST.blocks.map((b) => b.text));
    expect(suggestMerges(s)).toEqual([]);
  });

  it('rifiutando un suggerimento le altre proposte restano e nulla viene unito', () => {
    const dismissed = [cid('AIACE')];
    const s = suggestMerges(CAST, dismissed);
    expect(s).toHaveLength(3);
    expect(CAST.characters.some((c) => c.name === 'AIACE')).toBe(true);
  });

  it('non propone unioni tra personaggi reali con un numero di battute paragonabile', () => {
    const two = parseScript(linesFromText(`${rep('MARIO', 20)}\n${rep('MARIA', 6)}`), { fileName: 'm.pdf' });
    expect(suggestMerges(two)).toEqual([]);
  });
});
