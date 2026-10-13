// Copione sintetico originale: dialoghi rapidi, interruzioni, didascalie interne,
// battute brevi e un monologo.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PACING, type PacingSettings } from '../pacing/pacing';
import { linesFromText } from '../parser/lines';
import { parseScript } from '../parser/parse';
import { createDirector } from './director';
import { RehearsalEngine, type EngineState, type SpeakResult, type Speaker, type Timer } from './engine';
import { buildPlan, nextActorIndex, sceneRange } from './plan';

const SCRIPT = parseScript(
  linesFromText(`
ATTO I
SCENA 1
IRIS: Chi ha preso le chiavi?
FELICE: Non io.
IRIS: Allora chi? Tu? Lui?
NONNA: (dalla cucina) Le ho io! (si affaccia) Le avevate lasciate sul tavolo.
FELICE: Ma io non —
IRIS: Zitto. Ascolta.
SCENA 2
FELICE: Andiamo?
TUTTI: Andiamo!
NONNA: Quando avevo la vostra età uscivamo sempre dalla porta di servizio. Nessuno ci vedeva. Nessuno ci chiedeva niente. E tornavamo all'alba, felici.
IRIS: (Silenzio)
FELICE: Fine.
`),
  { fileName: 't.pdf' },
);
const id = (name: string) => SCRIPT.characters.find((c) => c.name === name)!.id;
const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 40) {
  for (let i = 0; i < n; i++) await flush();
}

/**
 * Sintesi finta: in modalità automatica ogni frase termina subito; altrimenti a comando.
 * L'audio "parte" subito (onStart), salvo `nextResult`, che simula una voce
 * che non parte ('stalled') o un errore ('error').
 */
class FakeSpeaker implements Speaker {
  log: { text: string; voice: string | null }[] = [];
  private pending: ((r: SpeakResult) => void) | null = null;
  failNext = false;
  nextResult: 'stalled' | 'error' | null = null;
  /** Se vero, l'avvio dell'audio va confermato a mano con start(). */
  holdStart = false;
  private onStart: (() => void) | undefined;
  constructor(public auto = false) {}
  speak(text: string, opts: { voiceURI: string | null }, onStart?: () => void) {
    this.log.push({ text, voice: opts.voiceURI });
    if (this.failNext) {
      this.failNext = false;
      return Promise.resolve('cancelled' as const);
    }
    if (this.nextResult) {
      const r = this.nextResult;
      this.nextResult = null;
      return Promise.resolve(r);
    }
    if (this.holdStart) this.onStart = onStart;
    else onStart?.();
    return new Promise<SpeakResult>((resolve) => {
      this.pending = resolve;
      if (this.auto) setTimeout(() => this.finish(), 0);
    });
  }
  cancel() {
    this.pending?.('cancelled');
    this.pending = null;
  }
  start() {
    this.onStart?.();
    this.onStart = undefined;
  }
  finish() {
    const p = this.pending;
    this.pending = null;
    p?.('end');
  }
  get busy() {
    return this.pending !== null;
  }
}

/** Timer finto: registra le pause e le esegue subito (o a comando). */
class FakeTimer implements Timer {
  waits: number[] = [];
  private pending: ((r: 'end' | 'cancelled') => void) | null = null;
  constructor(public auto = true) {}
  wait(ms: number) {
    this.waits.push(ms);
    return new Promise<'end' | 'cancelled'>((resolve) => {
      this.pending = resolve;
      if (this.auto) setTimeout(() => this.finish(), 0);
    });
  }
  cancel() {
    this.pending?.('cancelled');
    this.pending = null;
  }
  finish() {
    const p = this.pending;
    this.pending = null;
    p?.('end');
  }
  get busy() {
    return this.pending !== null;
  }
}

function setup(
  role: string | null,
  opts: { mode?: 'rehearsal' | 'full'; auto?: boolean; timerAuto?: boolean; pacing?: Partial<PacingSettings> } = {},
) {
  const pacing = { ...DEFAULT_PACING, ...opts.pacing };
  const plan = buildPlan(SCRIPT, role, opts.mode ?? 'rehearsal', null, pacing.readDirections);
  const director = createDirector(
    SCRIPT,
    plan,
    () => pacing,
    (character, narrator) => ({ voiceURI: narrator ? 'narratore' : character, rate: 1, pitch: 1 }),
  );
  const speaker = new FakeSpeaker(opts.auto ?? true);
  const timer = new FakeTimer(opts.timerAuto ?? true);
  const states: EngineState[] = [];
  const engine = new RehearsalEngine(plan, {
    speaker,
    timer,
    stepsOf: director.stepsOf,
    voiceOf: director.voiceOf,
    onChange: (s) => states.push(s),
  });
  const said = () => speaker.log.map((l) => l.text);
  return { plan, speaker, timer, engine, states, said };
}

const textAt = (plan: ReturnType<typeof buildPlan>, i: number) => SCRIPT.blocks[plan[i]!.blockIndex]!.text;

describe('piano di prova', () => {
  it('segue l’ordine del copione e segna le battute dell’attore', () => {
    const plan = buildPlan(SCRIPT, id('FELICE'), 'rehearsal', null);
    expect(plan.map((p) => p.actor)).toEqual([false, true, false, false, true, false, true, true, false, true]);
  });

  it('salta le battute altrui composte solo da didascalie', () => {
    const plan = buildPlan(SCRIPT, id('FELICE'), 'rehearsal', null);
    expect(plan.some((p) => textAt(plan, plan.indexOf(p)) === '(Silenzio)')).toBe(false);
  });

  it('in lettura completa non si ferma mai', () => {
    expect(buildPlan(SCRIPT, id('FELICE'), 'full', null).every((p) => !p.actor)).toBe(true);
  });

  it('limita la prova a una singola scena', () => {
    const scene2 = SCRIPT.blocks.find((b) => b.text === 'SCENA 2')!;
    const plan = buildPlan(SCRIPT, null, 'rehearsal', scene2.id);
    expect(plan.map((_, i) => textAt(plan, i))[0]).toBe('Andiamo?');
    const act = SCRIPT.blocks.find((b) => b.text === 'ATTO I')!;
    expect(sceneRange(SCRIPT, act.id)).toEqual([0, SCRIPT.blocks.length]);
  });

  it('trova la prossima battuta dell’attore', () => {
    const plan = buildPlan(SCRIPT, id('FELICE'), 'rehearsal', null);
    expect(nextActorIndex(plan, 2)).toBe(4);
    expect(nextActorIndex(plan, 10)).toBe(-1);
  });
});

describe('lettura con regia', () => {
  it('legge frase per frase, senza didascalie, e si ferma sul turno dell’attore', async () => {
    const { engine, said, states } = setup(id('FELICE'));
    engine.start();
    await settle();
    expect(said()).toEqual(['Chi ha preso le chiavi?']);
    expect(states.at(-1)).toMatchObject({ status: 'waiting', index: 1 });
  });

  it('l’attesa sul turno dell’attore non ha limiti di tempo', async () => {
    const { engine, timer, said } = setup(id('FELICE'));
    engine.start();
    await settle();
    const waits = timer.waits.length;
    await settle(200);
    expect(engine.state.status).toBe('waiting');
    expect(timer.waits.length).toBe(waits);
    expect(said()).toHaveLength(1);
  });

  it('dopo "Continua" legge tutte le frasi successive senza saltarne', async () => {
    const { engine, said } = setup(id('FELICE'));
    engine.start();
    await settle();
    engine.continue();
    await settle();
    expect(said()).toEqual([
      'Chi ha preso le chiavi?',
      'Allora chi?',
      'Tu?',
      'Lui?',
      'Le ho io!',
      'Le avevate lasciate sul tavolo.',
    ]);
    expect(engine.state).toMatchObject({ status: 'waiting', index: 4 });
  });

  it('usa la voce di ciascun personaggio', async () => {
    const { engine, speaker } = setup(id('FELICE'));
    engine.start();
    await settle();
    engine.continue();
    await settle();
    expect(speaker.log.map((l) => l.voice)).toEqual([id('IRIS'), id('IRIS'), id('IRIS'), id('IRIS'), id('NONNA'), id('NONNA')]);
  });

  it('inserisce le pause tra frasi e tra personaggi, più brevi dopo un’interruzione', async () => {
    const { engine, timer, plan } = setup(null, { mode: 'full' });
    const interrupted = plan.findIndex((_, i) => textAt(plan, i) === 'Ma io —');
    engine.goTo(interrupted, true);
    await settle(10);
    const before = timer.waits.length;
    await settle();
    // Dopo "Ma io —" la pausa d'attacco di IRIS è breve.
    expect(timer.waits[before]).toBeLessThan(DEFAULT_PACING.speakerPauseMs);
    expect(timer.waits.every((w) => w <= 1500)).toBe(true);
  });

  it('legge un monologo per intero', async () => {
    const { engine, said, plan } = setup(id('FELICE'));
    const mono = plan.findIndex((_, i) => textAt(plan, i).startsWith('Quando avevo'));
    engine.goTo(mono, true);
    await settle();
    expect(said()).toEqual([
      'Quando avevo la vostra età uscivamo sempre dalla porta di servizio.',
      'Nessuno ci vedeva.',
      'Nessuno ci chiedeva niente.',
      "E tornavamo all'alba, felici.",
    ]);
  });

  it('legge le didascalie con la voce narrante solo se richiesto', async () => {
    const { engine, speaker, plan } = setup(id('FELICE'), { pacing: { readDirections: true } });
    const nonna = plan.findIndex((_, i) => textAt(plan, i).startsWith('(dalla cucina)'));
    engine.goTo(nonna, true);
    await settle();
    expect(speaker.log.slice(0, 4)).toEqual([
      { text: 'dalla cucina', voice: 'narratore' },
      { text: 'Le ho io!', voice: id('NONNA') },
      { text: 'si affaccia', voice: 'narratore' },
      { text: 'Le avevate lasciate sul tavolo.', voice: id('NONNA') },
    ]);
  });
});

describe('pausa, ripresa, ripetizione', () => {
  it('la pausa a metà frase riprende dalla stessa frase', async () => {
    const { engine, speaker, said } = setup(id('FELICE'), { auto: false });
    engine.goTo(2, true); // "Allora chi? Tu? Lui?"
    await settle();
    speaker.finish(); // "Allora chi?" detta
    await settle();
    expect(said()).toEqual(['Allora chi?', 'Tu?']);
    engine.pause();
    expect(engine.state.status).toBe('paused');
    engine.continue();
    await settle();
    expect(said()).toEqual(['Allora chi?', 'Tu?', 'Tu?']);
    speaker.finish();
    await settle();
    speaker.finish();
    await settle();
    expect(said().slice(3)).toEqual(['Lui?', 'Le ho io!']);
  });

  it('la pausa durante una pausa di regia riprende dalla frase successiva', async () => {
    const { engine, speaker, timer, said } = setup(id('FELICE'), { auto: false, timerAuto: false });
    engine.goTo(2, true);
    await settle();
    speaker.finish();
    await settle();
    expect(timer.busy).toBe(true);
    engine.pause();
    engine.continue();
    await settle();
    expect(said()).toEqual(['Allora chi?', 'Tu?']);
  });

  it('"Ripeti" ricomincia la battuta dall’inizio senza perdere il punto', async () => {
    const { engine, speaker, said } = setup(id('FELICE'), { auto: false });
    engine.goTo(2, true);
    await settle();
    speaker.finish();
    await settle();
    engine.repeat();
    await settle();
    expect(said()).toEqual(['Allora chi?', 'Tu?', 'Allora chi?']);
    expect(engine.state.index).toBe(2);
  });

  it('"Ripeti" sul turno dell’attore ripete l’attacco e torna ad attendere', async () => {
    const { engine, said } = setup(id('FELICE'));
    engine.start();
    await settle();
    expect(engine.state).toMatchObject({ status: 'waiting', index: 1 });
    engine.repeat();
    await settle();
    expect(said()).toEqual(['Chi ha preso le chiavi?', 'Chi ha preso le chiavi?']);
    expect(engine.state).toMatchObject({ status: 'waiting', index: 1 });
  });

  it('un errore della sintesi mette in pausa sulla stessa frase', async () => {
    const { engine, speaker, said } = setup(id('FELICE'));
    speaker.failNext = true;
    engine.start();
    await settle();
    expect(engine.state.status).toBe('paused');
    engine.continue();
    await settle();
    expect(said()).toEqual(['Chi ha preso le chiavi?', 'Chi ha preso le chiavi?']);
    expect(engine.state.status).toBe('waiting');
  });

  it('avanti e indietro durante la lettura non saltano battute', async () => {
    const { engine, said, plan } = setup(null, { mode: 'full', auto: false });
    engine.start();
    await settle();
    engine.next();
    await settle();
    engine.previous();
    await settle();
    expect(said()).toEqual([textAt(plan, 0), textAt(plan, 1), textAt(plan, 0)]);
  });

  it('da fermo la navigazione sposta solo la posizione', async () => {
    const { engine, said } = setup(id('FELICE'));
    engine.next();
    engine.next();
    await settle();
    expect(engine.state).toMatchObject({ status: 'idle', index: 2 });
    expect(said()).toEqual([]);
  });

  it('una lettura completa non salta nessuna frase', async () => {
    const { engine, said, plan } = setup(null, { mode: 'full' });
    engine.start();
    await settle(400);
    expect(engine.state.status).toBe('finished');
    const director = createDirector(SCRIPT, plan, () => DEFAULT_PACING, () => ({ voiceURI: null, rate: 1, pitch: 1 }));
    const expected = plan.flatMap((_, i) =>
      director.parts(i).flatMap((p) => (p.kind === 'sentence' ? [p.text] : [])),
    );
    expect(said()).toEqual(expected);
  });
});

describe('frontespizio ed elenco personaggi', () => {
  it('non entrano mai nella prova, nemmeno leggendo le didascalie', () => {
    const s = parseScript(
      linesFromText(`
LA CASA SUL FIUME
Commedia di Autrice Immaginaria
Tutti i diritti riservati

PERSONAGGI
DORA, la sorella
EMO, il fratello

ATTO I
Una veranda. Mattina.
DORA: Piove.
EMO: Lo so.
DORA: Allora resta.
EMO: Resto.
`),
      { fileName: 'x.pdf', title: 'LA CASA SUL FIUME' },
    );
    for (const read of [false, true]) {
      const plan = buildPlan(s, null, 'full', null, read);
      const kinds = plan.map((p) => s.blocks[p.blockIndex]!.kind);
      expect(kinds).not.toContain('front');
      expect(kinds).not.toContain('cast');
      expect(kinds.filter((k) => k === 'speech')).toHaveLength(4);
    }
    // La descrizione iniziale della scena è una didascalia, letta solo su richiesta.
    expect(buildPlan(s, null, 'full', null, true).some((p) => s.blocks[p.blockIndex]!.text === 'Una veranda. Mattina.')).toBe(true);
  });
});

describe('avvio reale della voce', () => {
  it('"sta parlando" solo dopo la conferma dell\'avvio dell\'audio', async () => {
    const { engine, speaker, states } = setup(id('FELICE'), { auto: false });
    speaker.holdStart = true;
    engine.start();
    await settle();
    expect(states.at(-1)).toMatchObject({ status: 'starting', index: 0, part: null });
    speaker.start();
    expect(states.at(-1)).toMatchObject({ status: 'speaking', index: 0, part: 0 });
  });

  it('se la voce non parte: errore, nessun avanzamento e nessun nuovo tentativo automatico', async () => {
    const { engine, speaker, states, said } = setup(id('FELICE'));
    speaker.nextResult = 'stalled';
    engine.start();
    await settle();
    expect(states.at(-1)).toMatchObject({ status: 'failed', failure: 'timeout', index: 0 });
    expect(said()).toEqual(['Chi ha preso le chiavi?']);
    expect(states.some((s) => s.status === 'speaking')).toBe(false);
    expect(states.some((s) => s.status === 'waiting')).toBe(false);
    await settle(200);
    expect(said()).toHaveLength(1);
    expect(states.at(-1)).toMatchObject({ status: 'failed', index: 0 });
  });

  it('Riprova ripete la stessa frase una sola volta, poi la prova prosegue', async () => {
    const { engine, speaker, states, said } = setup(id('FELICE'));
    speaker.nextResult = 'stalled';
    engine.start();
    await settle();
    engine.continue();
    await settle();
    expect(said()).toEqual(['Chi ha preso le chiavi?', 'Chi ha preso le chiavi?']);
    expect(states.at(-1)).toMatchObject({ status: 'waiting', index: 1 });
  });

  it('un errore della sintesi ferma la prova sulla stessa frase', async () => {
    const { engine, speaker, states, said } = setup(id('IRIS'));
    speaker.nextResult = 'error';
    engine.goTo(1, true);
    await settle();
    expect(states.at(-1)).toMatchObject({ status: 'failed', failure: 'error', index: 1 });
    expect(said()).toEqual(['Non io.']);
  });

  it('la pausa durante l\'avvio non perde la frase', async () => {
    const { engine, speaker, states, said } = setup(id('FELICE'), { auto: false });
    speaker.holdStart = true;
    engine.start();
    await settle();
    engine.pause();
    expect(states.at(-1)).toMatchObject({ status: 'paused', index: 0 });
    speaker.holdStart = false;
    engine.continue();
    await settle();
    expect(said()).toEqual(['Chi ha preso le chiavi?', 'Chi ha preso le chiavi?']);
    expect(states.at(-1)).toMatchObject({ status: 'speaking', index: 0 });
  });
});
