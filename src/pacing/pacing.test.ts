// Frasi originali scritte per i test.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACING, MAX_PAUSE_MS, buildSteps, endsInterrupted, leadIn, performBlock, scalePause, scaleRate,
  splitSentences,
} from './pacing';

const texts = (t: string) => splitSentences(t).map((s) => s.text);

describe('segmentazione in frasi', () => {
  it('divide su punto, domanda ed esclamazione', () => {
    expect(texts('Piove. Hai l’ombrello? No! Allora corri.')).toEqual(['Piove.', 'Hai l’ombrello?', 'No!', 'Allora corri.']);
  });

  it('non divide su abbreviazioni, iniziali e numeri decimali', () => {
    expect(texts('Il sig. Rossi e il dott. Bianchi arrivano alle 3.30 con G. Verdi. Poi ripartono.')).toEqual([
      'Il sig. Rossi e il dott. Bianchi arrivano alle 3.30 con G. Verdi.',
      'Poi ripartono.',
    ]);
  });

  it('non divide sulle virgole', () => {
    expect(texts('Sì, certo, come no, domani.')).toEqual(['Sì, certo, come no, domani.']);
  });

  it('mantiene la punteggiatura multipla e le virgolette di chiusura', () => {
    expect(texts('Davvero?! Ha detto «basta». E poi?')).toEqual(['Davvero?!', 'Ha detto «basta».', 'E poi?']);
  });

  it('i puntini di sospensione a metà frase creano una pausa breve', () => {
    const s = splitSentences('Io… non so. Forse...');
    expect(s.map((x) => x.text)).toEqual(['Io…', 'non so.', 'Forse...']);
    expect(s[0]!.pauseAfterMs).toBeLessThan(s[2]!.pauseAfterMs);
  });

  it('pause diverse per punto, domanda e sospensione, senza eccessi', () => {
    const [a, b, c] = splitSentences('Va bene. Vieni? Aspetta...');
    expect(b!.pauseAfterMs).toBeGreaterThanOrEqual(a!.pauseAfterMs);
    expect(c!.pauseAfterMs).toBeGreaterThan(a!.pauseAfterMs);
    expect(Math.max(a!.pauseAfterMs, b!.pauseAfterMs, c!.pauseAfterMs)).toBeLessThanOrEqual(MAX_PAUSE_MS);
  });

  it('divide i monologhi con frasi lunghissime senza perdere testo', () => {
    const long =
      'Quando ero bambina passavo le estati dalla nonna, in una casa piena di libri e di gatti, dove il tempo sembrava non passare mai, e ogni sera ascoltavamo la radio seduti in cortile, mentre le zanzare ci divoravano le caviglie e nessuno aveva voglia di andare a dormire.';
    const s = splitSentences(long);
    expect(s.length).toBeGreaterThan(1);
    expect(s.every((x) => x.text.length <= 221)).toBe(true);
    expect(s.map((x) => x.text).join(' ')).toBe(long);
  });

  it('la frase interrotta da un trattino non aggiunge pausa', () => {
    expect(splitSentences('Ma io —').at(-1)!.pauseAfterMs).toBe(0);
  });
});

describe('battute e didascalie interne', () => {
  it('separa frasi e didascalie mantenendo l’ordine', () => {
    expect(performBlock('(chiama) Mamma! (pausa) Mamma, sei in casa?').map((p) => `${p.kind}:${p.text}`)).toEqual([
      'direction:(chiama)',
      'sentence:Mamma!',
      'direction:(pausa)',
      'sentence:Mamma, sei in casa?',
    ]);
  });

  it('per impostazione predefinita non pronuncia le didascalie', () => {
    const steps = buildSteps(performBlock('(chiama) Mamma! Sei in casa?'), DEFAULT_PACING, 0);
    expect(steps.filter((s) => s.type === 'say').map((s) => (s.type === 'say' ? s.text : ''))).toEqual([
      'Mamma!',
      'Sei in casa?',
    ]);
  });

  it('le legge con la voce narrante solo se richiesto', () => {
    const steps = buildSteps(performBlock('(chiama) Mamma!'), { ...DEFAULT_PACING, readDirections: true }, 0);
    const says = steps.filter((s) => s.type === 'say');
    expect(says).toEqual([
      { type: 'say', text: 'chiama', narrator: true, part: 0 },
      { type: 'say', text: 'Mamma!', narrator: false, part: 1 },
    ]);
  });

  it('inserisce le pause tra le frasi ma non dopo l’ultima', () => {
    const steps = buildSteps(performBlock('Uno. Due. Tre.'), DEFAULT_PACING, 0);
    expect(steps.map((s) => s.type)).toEqual(['say', 'pause', 'say', 'pause', 'say']);
  });

  it('una battuta di sola didascalia non produce nulla da dire', () => {
    expect(buildSteps(performBlock('(Silenzio)'), DEFAULT_PACING, 300)).toEqual([{ type: 'pause', ms: 300 }]);
  });
});

describe('ritmo', () => {
  it('il ritmo scala le pause entro limiti prudenti', () => {
    expect(scalePause(450, 1)).toBe(450);
    expect(scalePause(450, 1.4)).toBeLessThan(450);
    expect(scalePause(450, 0.7)).toBeGreaterThan(450);
    expect(scalePause(5000, 0.5)).toBe(MAX_PAUSE_MS);
    expect(scalePause(-10, 1)).toBe(0);
  });

  it('il ritmo cambia la velocità della voce solo di poco', () => {
    expect(scaleRate(1, 1)).toBe(1);
    expect(scaleRate(1, 1.4)).toBeLessThanOrEqual(1.06);
    expect(scaleRate(1, 0.7)).toBeGreaterThanOrEqual(0.95);
  });

  it('pausa d’attacco: cambio personaggio, interruzione, dopo l’attore, comando', () => {
    const p = DEFAULT_PACING;
    expect(leadIn('auto', 'Va bene.', false, p)).toBe(p.speakerPauseMs);
    expect(leadIn('auto', 'Ma io —', false, p)).toBeLessThan(p.speakerPauseMs);
    expect(leadIn('auto', 'Aspetta...', false, p)).toBeLessThan(p.speakerPauseMs);
    expect(leadIn('afterActor', undefined, false, p)).toBe(p.afterActorPauseMs);
    expect(leadIn('user', 'Va bene.', false, p)).toBe(0);
  });

  it('riconosce le battute interrotte', () => {
    expect(endsInterrupted('Non è come pensi, io —')).toBe(true);
    expect(endsInterrupted('Non è vero… (si volta)')).toBe(true);
    expect(endsInterrupted('Va bene.')).toBe(false);
  });
});
