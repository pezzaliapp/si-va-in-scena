// Copione sintetico originale con nomi errati simili a quelli che un PDF può contenere.
import { describe, expect, it } from 'vitest';
import { linesFromText } from '../parser/lines';
import { parseScript } from '../parser/parse';
import { defaultSettings } from '../types';
import { lineCounts, mergeCharacters } from './edit';
import { editDistance, mergeSettings, normalizeName, planBulkMerges, suggestMerges } from './similar';

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

describe('conferma collettiva delle correzioni', () => {
  const settings = defaultSettings(CAST.id);
  const nameIn = (sc: typeof CAST, i: string) => sc.characters.find((c) => c.id === i)?.name;

  it('11 nomi → 7 personaggi con una sola conferma, senza perdere battute', () => {
    const plan = planBulkMerges(CAST, settings, suggestMerges(CAST));
    expect(plan.merges).toHaveLength(4);
    expect(plan.individual).toEqual([]);
    expect(plan.script.characters).toHaveLength(7);
    const before = [...lineCounts(CAST).values()].reduce((a, b) => a + b, 0);
    const after = lineCounts(plan.script);
    expect([...after.values()].reduce((a, b) => a + b, 0)).toBe(before);
    expect(after.get(cid('ALICE'))).toBe(19);
    expect(plan.script.blocks.map((b) => b.text)).toEqual(CAST.blocks.map((b) => b.text));
    expect(suggestMerges(plan.script)).toEqual([]);
  });

  it('nulla cambia finché non si conferma: il piano non modifica il copione di partenza', () => {
    planBulkMerges(CAST, settings, suggestMerges(CAST));
    expect(CAST.characters).toHaveLength(11);
  });

  it('i casi ambigui restano da decidere singolarmente', () => {
    const plan = planBulkMerges(SCRIPT, defaultSettings(SCRIPT.id), suggestMerges(SCRIPT));
    expect(plan.individual.map((x) => [names([x.fromId])[0], x.reason])).toEqual([['MARIE', 'candidati']]);
    expect(plan.merges).toHaveLength(4);
    expect(plan.script.characters.some((c) => c.name === 'MARIE')).toBe(true);
  });

  it('voci scelte diverse: esclusa dalla conferma collettiva, le altre si applicano', () => {
    const st = {
      ...settings,
      voices: {
        [cid('AUCE')]: { voiceURI: 'v1', rate: 1, pitch: 1 },
        [cid('ALICE')]: { voiceURI: 'v2', rate: 1, pitch: 1 },
      },
    };
    const plan = planBulkMerges(CAST, st, suggestMerges(CAST));
    expect(plan.individual.map((x) => [nameIn(CAST, x.fromId), x.reason])).toEqual([['AUCE', 'voci']]);
    expect(plan.merges.map((m) => nameIn(CAST, m.fromId)).sort()).toEqual(['AIACE', 'CARIA', 'WAI.TER']);
    expect(plan.settings.voices[cid('ALICE')]!.voiceURI).toBe('v2');
    expect(plan.settings.voices[cid('AUCE')]).toEqual({ voiceURI: 'v1', rate: 1, pitch: 1 });
  });

  it('conflitto che nasce da un’unione precedente: la seconda resta da decidere', () => {
    const st = {
      ...settings,
      voices: {
        [cid('AUCE')]: { voiceURI: 'v1', rate: 1, pitch: 1 },
        [cid('AIACE')]: { voiceURI: 'v2', rate: 1, pitch: 1 },
      },
    };
    const plan = planBulkMerges(CAST, st, suggestMerges(CAST));
    expect(plan.individual).toHaveLength(1);
    expect(plan.settings.voices[cid('ALICE')]).toBeDefined();
  });

  it('ruolo, voce scelta e genere della voce passano al personaggio unito', () => {
    const marked = {
      ...CAST,
      characters: CAST.characters.map((c) => (c.name === 'AUCE' ? { ...c, voice: 'f' as const } : c)),
    };
    const st = {
      ...settings,
      role: cid('WAI.TER'),
      voices: { [cid('CARIA')]: { voiceURI: 'v3', rate: 1.1, pitch: 1 } },
    };
    const plan = planBulkMerges(marked, st, suggestMerges(marked));
    expect(plan.settings.role).toBe(cid('WALTER'));
    expect(plan.settings.voices[cid('CARLA')]).toEqual({ voiceURI: 'v3', rate: 1.1, pitch: 1 });
    expect(plan.script.characters.find((c) => c.name === 'ALICE')!.voice).toBe('f');
  });

  it('nome proposto a sua volta sospetto: nessuna unione a catena automatica', () => {
    const chain = parseScript(linesFromText(`${rep('CARLONE', 20)}\n${rep('CARLO', 5)}\nCARIO: Eccomi.`), {
      fileName: 'c.pdf',
    });
    const plan = planBulkMerges(chain, defaultSettings(chain.id), suggestMerges(chain));
    expect(plan.individual.map((x) => [nameIn(chain, x.fromId), x.reason])).toEqual([['CARIO', 'catena']]);
    expect(plan.merges.map((m) => nameIn(chain, m.fromId))).toEqual(['CARLO']);
  });
});
