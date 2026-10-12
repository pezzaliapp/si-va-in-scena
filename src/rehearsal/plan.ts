import { speakableText } from '../speech/text';
import { EVERYONE, type Block, type Mode, type Script } from '../types';

export interface PlanItem {
  blockIndex: number;
  /** Vero se la battuta spetta all'attore: la lettura si ferma. */
  actor: boolean;
}

export function isActorLine(block: Block, role: string | null): boolean {
  return !!role && block.kind === 'speech' && (block.speakers.includes(role) || block.speakers.includes(EVERYONE));
}

/** Intervallo [inizio, fine) dei blocchi di una scena o di un atto. */
export function sceneRange(script: Script, sceneId: string | null): [number, number] {
  const start = sceneId ? script.blocks.findIndex((b) => b.id === sceneId) : -1;
  if (start < 0) return [0, script.blocks.length];
  const level = script.blocks[start]!.level ?? 1;
  const next = script.blocks.findIndex((b, i) => i > start && b.kind === 'heading' && (b.level ?? 1) <= level);
  return [start, next < 0 ? script.blocks.length : next];
}

/** Sequenza delle battute da leggere o attendere, nell'ordine del copione. */
export function buildPlan(script: Script, role: string | null, mode: Mode, sceneId: string | null): PlanItem[] {
  const [start, end] = sceneRange(script, sceneId);
  const plan: PlanItem[] = [];
  for (let i = start; i < end; i++) {
    const b = script.blocks[i]!;
    if (b.kind !== 'speech') continue;
    const actor = mode !== 'full' && isActorLine(b, role);
    if (!actor && !speakableText(b.text)) continue;
    plan.push({ blockIndex: i, actor });
  }
  return plan;
}
