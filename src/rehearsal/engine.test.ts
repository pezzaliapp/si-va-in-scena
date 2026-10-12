// Dialogo originale scritto per i test.
import { describe, expect, it } from 'vitest';
import { linesFromText } from '../parser/lines';
import { parseScript } from '../parser/parse';
import { RehearsalEngine, type EngineState, type Speaker } from './engine';
import { buildPlan, sceneRange } from './plan';

const SCRIPT = parseScript(
  linesFromText(`
ATTO I
SCENA 1
IRIS: Chi ha preso le chiavi?
FELICE: Non io.
IRIS: Allora chi?
NONNA: (dalla cucina) Le ho io!
SCENA 2
FELICE: Andiamo?
TUTTI: Andiamo!
IRIS: (Silenzio)
FELICE: Fine.
`),
  { fileName: 't.pdf' },
);
const id = (name: string) => SCRIPT.characters.find((c) => c.name === name)!.id;

/** Sintesi vocale finta e controllabile manualmente. */
class FakeSpeaker implements Speaker {
  spoken: string[] = [];
  private pending: ((r: 'end' | 'cancelled') => void) | null = null;
  speak(text: string) {
    this.spoken.push(text);
    return new Promise<'end' | 'cancelled'>((resolve) => (this.pending = resolve));
  }
  cancel() {
    this.pending?.('cancelled');
    this.pending = null;
  }
  async finish() {
    const p = this.pending;
    this.pending = null;
    p?.('end');
    await flush();
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(role: string | null, mode: 'rehearsal' | 'full' = 'rehearsal', scene: string | null = null) {
  const plan = buildPlan(SCRIPT, role, mode, scene);
  const speaker = new FakeSpeaker();
  const states: EngineState[] = [];
  const engine = new RehearsalEngine(plan, {
    speaker,
    textOf: (it) => SCRIPT.blocks[it.blockIndex]!.text,
    voiceOf: () => ({ voiceURI: null, rate: 1, pitch: 1 }),
    onChange: (s) => states.push(s),
  });
  return { plan, speaker, engine, states };
}

describe('piano di prova', () => {
  it('contiene le battute nell’ordine del copione e segna quelle dell’attore', () => {
    const plan = buildPlan(SCRIPT, id('FELICE'), 'rehearsal', null);
    const rows = plan.map((p) => [SCRIPT.blocks[p.blockIndex]!.text, p.actor]);
    expect(rows).toEqual([
      ['Chi ha preso le chiavi?', false],
      ['Non io.', true],
      ['Allora chi?', false],
      ['(dalla cucina) Le ho io!', false],
      ['Andiamo?', true],
      ['Andiamo!', true],
      ['Fine.', true],
    ]);
  });

  it('salta le battute altrui composte solo da didascalie', () => {
    const plan = buildPlan(SCRIPT, id('FELICE'), 'rehearsal', null);
    expect(plan.some((p) => SCRIPT.blocks[p.blockIndex]!.text === '(Silenzio)')).toBe(false);
  });

  it('in lettura completa non si ferma mai', () => {
    expect(buildPlan(SCRIPT, id('FELICE'), 'full', null).every((p) => !p.actor)).toBe(true);
  });

  it('limita la prova a una singola scena', () => {
    const scene2 = SCRIPT.blocks.find((b) => b.text === 'SCENA 2')!;
    const plan = buildPlan(SCRIPT, null, 'rehearsal', scene2.id);
    expect(plan.map((p) => SCRIPT.blocks[p.blockIndex]!.text)).toEqual(['Andiamo?', 'Andiamo!', 'Fine.']);
    const act = SCRIPT.blocks.find((b) => b.text === 'ATTO I')!;
    expect(sceneRange(SCRIPT, act.id)).toEqual([0, SCRIPT.blocks.length]);
  });
});

describe('stato della riproduzione', () => {
  it('legge gli altri personaggi e si ferma sul turno dell’attore', async () => {
    const { engine, speaker } = setup(id('FELICE'));
    engine.start();
    await flush();
    expect(engine.state).toEqual({ status: 'speaking', index: 0 });
    expect(speaker.spoken).toEqual(['Chi ha preso le chiavi?']);
    await speaker.finish();
    expect(engine.state).toEqual({ status: 'waiting', index: 1 });
    expect(speaker.spoken).toHaveLength(1);
  });

  it('riprende con "Continua" dopo il turno dell’attore', async () => {
    const { engine, speaker } = setup(id('FELICE'));
    engine.start();
    await flush();
    await speaker.finish();
    engine.continue();
    await flush();
    expect(engine.state).toEqual({ status: 'speaking', index: 2 });
    await speaker.finish();
    expect(speaker.spoken).toEqual(['Chi ha preso le chiavi?', 'Allora chi?', 'Le ho io!']);
    await speaker.finish();
    expect(engine.state).toEqual({ status: 'waiting', index: 4 });
  });

  it('si ferma sulle battute corali (TUTTI)', async () => {
    const { engine, speaker } = setup(id('NONNA'));
    engine.goTo(4, true);
    await flush();
    await speaker.finish();
    expect(engine.state).toEqual({ status: 'waiting', index: 5 });
  });

  it('mette in pausa e riprende dallo stesso punto', async () => {
    const { engine, speaker } = setup(id('FELICE'));
    engine.start();
    await flush();
    engine.pause();
    expect(engine.state.status).toBe('paused');
    engine.continue();
    await flush();
    expect(engine.state).toEqual({ status: 'speaking', index: 0 });
    expect(speaker.spoken).toEqual(['Chi ha preso le chiavi?', 'Chi ha preso le chiavi?']);
  });

  it('ripete, torna indietro e va avanti', async () => {
    const { engine, speaker } = setup(id('FELICE'));
    engine.start();
    await flush();
    engine.repeat();
    await flush();
    expect(speaker.spoken).toEqual(['Chi ha preso le chiavi?', 'Chi ha preso le chiavi?']);
    engine.next();
    await flush();
    expect(engine.state).toEqual({ status: 'waiting', index: 1 });
    engine.next();
    await flush();
    expect(engine.state).toEqual({ status: 'speaking', index: 2 });
    engine.previous();
    await flush();
    expect(engine.state).toEqual({ status: 'waiting', index: 1 });
  });

  it('da fermo la navigazione sposta solo la posizione', async () => {
    const { engine, speaker } = setup(id('FELICE'));
    engine.next();
    engine.next();
    await flush();
    expect(engine.state).toEqual({ status: 'idle', index: 2 });
    expect(speaker.spoken).toEqual([]);
  });

  it('arriva alla fine del copione', async () => {
    const { engine, speaker } = setup(null, 'full');
    engine.goTo(6, true);
    await flush();
    await speaker.finish();
    expect(engine.state.status).toBe('finished');
  });

  it('senza ruolo scelto legge tutto senza fermarsi', async () => {
    const { engine, speaker } = setup(null);
    engine.start();
    for (let i = 0; i < 7; i++) await speaker.finish();
    expect(engine.state.status).toBe('finished');
    expect(speaker.spoken).toHaveLength(7);
  });
});
