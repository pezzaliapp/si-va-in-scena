// Correzioni manuali del copione. Ogni funzione restituisce un nuovo oggetto.
import { EVERYONE, type Block, type Script } from '../types';

function touch(script: Script, patch: Partial<Script>): Script {
  return { ...script, ...patch, updatedAt: Date.now() };
}

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function renameCharacter(script: Script, id: string, name: string): Script {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) return script;
  return touch(script, { characters: script.characters.map((c) => (c.id === id ? { ...c, name: clean } : c)) });
}

/** Unisce il personaggio `fromId` in `intoId` (es. due grafie dello stesso nome). */
export function mergeCharacters(script: Script, fromId: string, intoId: string): Script {
  if (fromId === intoId) return script;
  return touch(script, {
    characters: script.characters.filter((c) => c.id !== fromId),
    blocks: script.blocks.map((b) =>
      b.speakers.includes(fromId)
        ? { ...b, speakers: [...new Set(b.speakers.map((s) => (s === fromId ? intoId : s)))] }
        : b,
    ),
  });
}

export function addCharacter(script: Script, name: string): { script: Script; id: string } {
  const id = newId('p');
  const clean = name.replace(/\s+/g, ' ').trim();
  return { script: touch(script, { characters: [...script.characters, { id, name: clean }] }), id };
}

/** Elimina un personaggio senza battute. */
export function removeCharacter(script: Script, id: string): Script {
  if (script.blocks.some((b) => b.speakers.includes(id))) return script;
  return touch(script, { characters: script.characters.filter((c) => c.id !== id) });
}

export function updateBlock(script: Script, id: string, patch: Partial<Omit<Block, 'id'>>): Script {
  return touch(script, {
    blocks: script.blocks.map((b) => {
      if (b.id !== id) return b;
      const next = { ...b, ...patch };
      if (next.kind !== 'speech') next.speakers = [];
      if (next.kind !== 'heading') delete next.level;
      else next.level ??= 1;
      next.simultaneous = next.speakers.length > 1 || next.speakers.includes(EVERYONE) || undefined;
      if (!next.simultaneous) delete next.simultaneous;
      return next;
    }),
  });
}

/** Divide un blocco in due nel punto indicato; il secondo mantiene lo stesso tipo e personaggi. */
export function splitBlock(script: Script, id: string, at: number): Script {
  const i = script.blocks.findIndex((b) => b.id === id);
  const b = script.blocks[i];
  if (!b) return script;
  const first = b.text.slice(0, at).trim();
  const second = b.text.slice(at).trim();
  if (!first || !second) return script;
  const blocks = [...script.blocks];
  blocks.splice(i, 1, { ...b, text: first }, { ...b, id: newId('b'), text: second, note: undefined });
  return touch(script, { blocks });
}

/** Unisce il blocco al precedente (il testo viene accodato). */
export function mergeWithPrevious(script: Script, id: string): Script {
  const i = script.blocks.findIndex((b) => b.id === id);
  if (i < 1) return script;
  const prev = script.blocks[i - 1]!;
  const cur = script.blocks[i]!;
  const blocks = [...script.blocks];
  blocks.splice(i - 1, 2, { ...prev, text: `${prev.text} ${cur.text}`.trim() });
  return touch(script, { blocks });
}

export function deleteBlock(script: Script, id: string): Script {
  return touch(script, { blocks: script.blocks.filter((b) => b.id !== id) });
}

export function lineCounts(script: Script): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of script.blocks) {
    if (b.kind !== 'speech') continue;
    for (const s of b.speakers) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return counts;
}

export function speakerLabel(script: Script, speakers: string[]): string {
  return speakers
    .map((id) => (id === EVERYONE ? 'TUTTI' : (script.characters.find((c) => c.id === id)?.name ?? '?')))
    .join(' e ');
}
