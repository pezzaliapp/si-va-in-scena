// Dialogo originale scritto per i test.
import { describe, expect, it } from 'vitest';
import { linesFromText } from '../parser/lines';
import { parseScript } from '../parser/parse';
import {
  addCharacter, deleteBlock, lineCounts, mergeCharacters, mergeWithPrevious, renameCharacter,
  splitBlock, updateBlock,
} from './edit';

const base = () =>
  parseScript(
    linesFromText(`
SARA: Il treno è in ritardo. Come al solito.
DARIO: Prendiamo un caffè.
SARA: Volentieri.
DARIO: Offro io.
DARI0: Anzi no.
`),
    { fileName: 'treno.pdf' },
  );

describe('correzione del copione', () => {
  it('rinomina un personaggio', () => {
    const s = renameCharacter(base(), 'p1', '  Sara  ');
    expect(s.characters[0]!.name).toBe('Sara');
  });

  it('unisce due grafie dello stesso personaggio', () => {
    const s0 = base();
    const typo = s0.characters.find((c) => c.name === 'DARI0')!;
    const s = mergeCharacters(s0, typo.id, 'p2');
    expect(s.characters.map((c) => c.name)).toEqual(['SARA', 'DARIO']);
    expect(lineCounts(s).get('p2')).toBe(3);
  });

  it('riattribuisce una battuta e la segna come verificata', () => {
    const s0 = base();
    const b = s0.blocks.find((x) => x.text === 'Anzi no.')!;
    const s = updateBlock(s0, b.id, { speakers: ['p2'], ambiguous: undefined });
    expect(s.blocks.find((x) => x.id === b.id)!.speakers).toEqual(['p2']);
    expect(s.blocks.find((x) => x.id === b.id)!.ambiguous).toBeUndefined();
  });

  it('trasforma una battuta in didascalia', () => {
    const s0 = base();
    const s = updateBlock(s0, s0.blocks[1]!.id, { kind: 'direction' });
    expect(s.blocks[1]!.kind).toBe('direction');
    expect(s.blocks[1]!.speakers).toEqual([]);
  });

  it('divide e riunisce una battuta', () => {
    const s0 = base();
    const first = s0.blocks[0]!;
    const split = splitBlock(s0, first.id, first.text.indexOf('Come'));
    expect(split.blocks.slice(0, 2).map((b) => b.text)).toEqual(['Il treno è in ritardo.', 'Come al solito.']);
    const assigned = updateBlock(split, split.blocks[1]!.id, { speakers: ['p2'] });
    expect(assigned.blocks[1]!.speakers).toEqual(['p2']);
    const merged = mergeWithPrevious(split, split.blocks[1]!.id);
    expect(merged.blocks[0]!.text).toBe(first.text);
    expect(merged.blocks).toHaveLength(s0.blocks.length);
  });

  it('aggiunge un personaggio ed elimina un blocco', () => {
    const { script, id } = addCharacter(base(), 'CAPOTRENO');
    expect(script.characters.at(-1)).toEqual({ id, name: 'CAPOTRENO' });
    const s = deleteBlock(script, script.blocks[0]!.id);
    expect(s.blocks).toHaveLength(script.blocks.length - 1);
  });
});
