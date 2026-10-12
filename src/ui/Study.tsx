import { useMemo, useState } from 'react';
import { isActorLine } from '../rehearsal/plan';
import { speakerLabel } from '../script/edit';
import { segmentSpeech } from '../script/segments';
import type { Block, Script } from '../types';

interface Props {
  script: Script;
  role: string | null;
  onChooseRole(): void;
}

interface Entry {
  cue?: Block;
  line: Block;
}

export default function Study({ script, role, onChooseRole }: Props) {
  const [hide, setHide] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());

  const entries = useMemo(() => {
    const out: Entry[] = [];
    let lastOther: Block | undefined;
    for (const b of script.blocks) {
      if (b.kind !== 'speech') continue;
      if (isActorLine(b, role)) {
        out.push({ cue: lastOther, line: b });
        lastOther = undefined;
      } else lastOther = b;
    }
    return out;
  }, [script, role]);

  if (!role) {
    return (
      <section className="panel">
        <p className="notice">Per studiare la tua parte scegli prima il personaggio.</p>
        <button className="btn primary" onClick={onChooseRole}>
          Scegli il ruolo
        </button>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="panel compact">
        <h2>La tua parte ({entries.length} battute)</h2>
        <p className="hint">Ogni battuta è preceduta dall’ultima battuta che ti dà l’attacco.</p>
        <label className="check strong">
          <input
            type="checkbox"
            checked={hide}
            onChange={(e) => {
              setHide(e.target.checked);
              setShown(new Set());
            }}
          />
          Nascondi le mie battute (tocca per mostrarle)
        </label>
      </section>
      <ol className="study-list">
        {entries.map(({ cue, line }) => {
          const visible = !hide || shown.has(line.id);
          return (
            <li key={line.id} className="study-item">
              {cue && (
                <p className="cue">
                  <strong>{speakerLabel(script, cue.speakers)}: </strong>
                  {cue.text}
                </p>
              )}
              {visible ? (
                <p className="mine-text">
                  {segmentSpeech(line.text).map((seg, i) => (
                    <span key={i} className={seg.kind === 'direction' ? 'inline-direction' : undefined}>
                      {seg.text}{' '}
                    </span>
                  ))}
                </p>
              ) : (
                <button className="btn reveal" onClick={() => setShown((s) => new Set(s).add(line.id))}>
                  Mostra la battuta
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
