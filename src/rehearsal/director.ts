// Collega piano di prova, regia vocale e voci: produce i passi per il motore.
import {
  buildSteps, leadIn, performBlock, scaleRate, type Arrival, type PacingSettings, type Part, type Step,
} from '../pacing/pacing';
import type { Script } from '../types';
import type { SpeakOptions } from './engine';
import type { PlanItem } from './plan';

export interface Director {
  parts(index: number): Part[];
  stepsOf(index: number, arrival: Arrival): Step[];
  voiceOf(index: number, step: Extract<Step, { type: 'say' }>): SpeakOptions;
}

export function createDirector(
  script: Script,
  plan: PlanItem[],
  pacing: () => PacingSettings,
  voiceFor: (characterId: string | null, narrator: boolean) => SpeakOptions,
): Director {
  const cache = new Map<number, Part[]>();
  const block = (index: number) => script.blocks[plan[index]!.blockIndex]!;
  const parts = (index: number) => {
    let p = cache.get(index);
    if (!p) {
      const b = block(index);
      // Una didascalia autonoma è un'unica parte da leggere con la voce narrante.
      p = b.kind === 'direction' ? [{ kind: 'direction', text: b.text }] : performBlock(b.text);
      cache.set(index, p);
    }
    return p;
  };
  return {
    parts,
    stepsOf(index, arrival) {
      const p = pacing();
      const prev = index > 0 ? block(index - 1) : undefined;
      const cur = block(index);
      const same = !!prev && prev.kind === 'speech' && prev.speakers.join() === cur.speakers.join();
      const pause = leadIn(arrival, prev?.kind === 'speech' ? prev.text : undefined, same, p);
      const narratorOnly = !!plan[index]!.narrator;
      return buildSteps(parts(index), narratorOnly ? { ...p, readDirections: true } : p, pause, narratorOnly);
    },
    voiceOf(index, step) {
      const b = block(index);
      const speaker = b.speakers.find((s) => s !== '*') ?? null;
      const v = voiceFor(step.narrator ? null : speaker, step.narrator);
      return { ...v, rate: scaleRate(v.rate, pacing().tempo) };
    },
  };
}
