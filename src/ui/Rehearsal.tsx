import { useEffect, useMemo, useRef, useState } from 'react';
import { RehearsalEngine, type EngineState } from '../rehearsal/engine';
import { buildPlan } from '../rehearsal/plan';
import { speakerLabel } from '../script/edit';
import { WebSpeechSpeaker } from '../speech/speaker';
import { appLang, resolveVoice, speechSupported, toInfo } from '../speech/voices';
import { EVERYONE, type GlobalPrefs, type Mode, type Script, type ScriptSettings } from '../types';

interface Props {
  script: Script;
  settings: ScriptSettings;
  voices: SpeechSynthesisVoice[];
  prefs: GlobalPrefs;
  onChange(patch: Partial<ScriptSettings>): void;
}

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'rehearsal', label: 'Prova', hint: 'L’app legge gli altri personaggi e si ferma sulle tue battute.' },
  { id: 'memorize', label: 'Memoria', hint: 'Come la prova, ma le tue battute sono nascoste finché non le mostri.' },
  { id: 'full', label: 'Lettura completa', hint: 'L’app legge tutto il copione, comprese le tue battute.' },
];

const STATUS_LABEL: Record<EngineState['status'], string> = {
  idle: 'Pronto',
  speaking: 'In lettura',
  paused: 'In pausa',
  waiting: 'Tocca a te',
  finished: 'Fine',
};

export default function Rehearsal({ script, settings, voices, prefs, onChange }: Props) {
  const { role, mode, sceneId } = settings;
  const plan = useMemo(() => buildPlan(script, role, mode, sceneId), [script, role, mode, sceneId]);
  const [state, setState] = useState<EngineState>({ status: 'idle', index: 0 });
  const [revealedIndex, setRevealedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<RehearsalEngine | null>(null);

  // Valori letti dal motore al momento di ogni battuta, senza ricrearlo.
  const live = useRef({ settings, voices, prefs, onChange });
  useEffect(() => {
    live.current = { settings, voices, prefs, onChange };
  });

  const infos = useMemo(() => voices.map(toInfo), [voices]);
  const noVoice = speechSupported() && voices.length > 0 && !resolveVoice(undefined, infos, prefs.strictPrivacy, appLang());

  useEffect(() => {
    const { settings: st } = live.current;
    const startIndex = Math.max(0, plan.findIndex((p) => p.blockIndex >= st.position));
    const speaker = speechSupported()
      ? new WebSpeechSpeaker(() => live.current.voices, setError)
      : { speak: async () => 'cancelled' as const, cancel() {} };
    const engine = new RehearsalEngine(
      plan,
      {
        speaker,
        textOf: (item) => script.blocks[item.blockIndex]!.text,
        voiceOf: (item) => {
          const { settings: s, voices: v, prefs: p } = live.current;
          const id = script.blocks[item.blockIndex]!.speakers.find((x) => x !== EVERYONE);
          return (
            resolveVoice(id ? s.voices[id] : undefined, v.map(toInfo), p.strictPrivacy, appLang()) ?? {
              voiceURI: null,
              rate: 1,
              pitch: 1,
            }
          );
        },
        onChange: (s) => {
          setState(s);
          const item = plan[s.index];
          if (item) live.current.onChange({ position: item.blockIndex });
        },
      },
    );
    engineRef.current = engine;
    // Notifica lo stato iniziale tramite onChange.
    engine.goTo(startIndex, false);
    return () => engine.stop();
  }, [plan, script]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine || (e.target as HTMLElement).closest('input, select, textarea, button')) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (engine.state.status === 'speaking') engine.pause();
        else engine.continue();
      } else if (e.key === 'ArrowRight') engine.next();
      else if (e.key === 'ArrowLeft') engine.previous();
      else if (e.key.toLowerCase() === 'r') engine.repeat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scenes = script.blocks.filter((b) => b.kind === 'heading');
  const item = plan[state.index];
  const block = item ? script.blocks[item.blockIndex] : undefined;
  const context = item ? script.blocks.slice(Math.max(0, item.blockIndex - 3), item.blockIndex) : [];
  const hidden = mode === 'memorize' && item?.actor && revealedIndex !== state.index;
  const act = (fn: (e: RehearsalEngine) => void) => {
    setError(null);
    if (engineRef.current) fn(engineRef.current);
  };

  return (
    <div className="stack">
      <section className="panel compact">
        <div className="segmented" role="radiogroup" aria-label="Modalità">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              className={mode === m.id ? 'active' : ''}
              onClick={() => onChange({ mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="hint">{MODES.find((m) => m.id === mode)?.hint}</p>
        {scenes.length > 0 && (
          <label className="field">
            Parte da provare
            <select
              className="select"
              value={sceneId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                const start = id ? script.blocks.findIndex((b) => b.id === id) : 0;
                onChange({ sceneId: id, position: Math.max(0, start) });
              }}
            >
              <option value="">Tutto il copione</option>
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.level === 2 ? '   ' : ''}
                  {s.text}
                </option>
              ))}
            </select>
          </label>
        )}
        {!role && mode !== 'full' && (
          <p className="notice">Non hai scelto un ruolo: l’app leggerà tutte le battute senza fermarsi.</p>
        )}
      </section>

      {!speechSupported() && <p className="alert">Questo browser non supporta la sintesi vocale.</p>}
      {noVoice && (
        <p className="alert">
          Nessuna voce locale disponibile in privacy rigorosa. Installa una voce nel sistema o modifica l’impostazione
          nella sezione Voci.
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <section className={`stage ${state.status}`} aria-live="polite">
        <div className="stage-status">
          <span className="status-label">{STATUS_LABEL[state.status]}</span>
          {plan.length > 0 && (
            <span className="progress">
              {state.index + 1} / {plan.length}
            </span>
          )}
        </div>
        {plan.length === 0 ? (
          <p className="empty">Nessuna battuta da leggere in questa parte.</p>
        ) : (
          <>
            <div className="context">
              {context.map((b) => (
                <p key={b.id} className={`ctx ${b.kind}`}>
                  {b.kind === 'speech' && <strong>{speakerLabel(script, b.speakers)}: </strong>}
                  {b.text}
                </p>
              ))}
            </div>
            {block && (
              <div className={`current ${item?.actor ? 'mine' : ''}`}>
                <p className="current-speaker">
                  {speakerLabel(script, block.speakers)}
                  {block.note ? <span className="note"> ({block.note})</span> : null}
                  {item?.actor && <span className="badge">La tua battuta</span>}
                </p>
                {hidden ? (
                  <button className="btn reveal" onClick={() => setRevealedIndex(state.index)}>
                    Mostra la battuta
                  </button>
                ) : (
                  <p className="current-text">{block.text}</p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <section className="controls" aria-label="Comandi della prova">
        {state.status === 'speaking' ? (
          <button className="btn large" onClick={() => act((e) => e.pause())}>
            Pausa
          </button>
        ) : state.status === 'paused' || state.status === 'waiting' ? (
          <button className="btn primary large" onClick={() => act((e) => e.continue())}>
            Continua
          </button>
        ) : (
          <button className="btn primary large" onClick={() => act((e) => e.start())} disabled={plan.length === 0 || noVoice}>
            Avvia
          </button>
        )}
        <button className="btn large" onClick={() => act((e) => e.repeat())} disabled={plan.length === 0}>
          Ripeti
        </button>
        <button className="btn large" onClick={() => act((e) => e.previous())} disabled={state.index === 0}>
          ← Precedente
        </button>
        <button className="btn large" onClick={() => act((e) => e.next())} disabled={plan.length === 0}>
          Successiva →
        </button>
      </section>
      <p className="hint center">Da tastiera: Spazio avvia/pausa/continua, frecce per spostarsi, R per ripetere.</p>
    </div>
  );
}
