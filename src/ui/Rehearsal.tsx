import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PACING, TEMPO_MAX, TEMPO_MIN, type PacingSettings } from '../pacing/pacing';
import { createDirector, type Director } from '../rehearsal/director';
import { RehearsalEngine, realTimer, type EngineState } from '../rehearsal/engine';
import { buildPlan, nextActorIndex } from '../rehearsal/plan';
import { lineCounts, speakerLabel } from '../script/edit';
import { START_TIMEOUT_MS, WebSpeechSpeaker } from '../speech/speaker';
import { appLang, resolveVoice, scriptVoices, speechSupported, toInfo } from '../speech/voices';
import type { GlobalPrefs, Mode, Script, ScriptSettings } from '../types';
import { setBusy } from '../update';

interface Props {
  script: Script;
  settings: ScriptSettings;
  voices: SpeechSynthesisVoice[];
  voicesReady: boolean;
  prefs: GlobalPrefs;
  onChange(patch: Partial<ScriptSettings>): void;
}

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'rehearsal', label: 'Prova', hint: 'L’app legge gli altri personaggi e si ferma sulle tue battute.' },
  { id: 'memorize', label: 'Memoria', hint: 'Come la prova, ma le tue battute sono nascoste finché non le mostri.' },
  { id: 'full', label: 'Lettura completa', hint: 'L’app legge tutto il copione, comprese le tue battute.' },
];

const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

export default function Rehearsal({ script, settings, voices, voicesReady, prefs, onChange }: Props) {
  const { role, mode, sceneId } = settings;
  const pacing: PacingSettings = { ...DEFAULT_PACING, ...settings.pacing };
  const readDirections = pacing.readDirections;
  const plan = useMemo(
    () => buildPlan(script, role, mode, sceneId, readDirections),
    [script, role, mode, sceneId, readDirections],
  );
  const [state, setState] = useState<EngineState>({ status: 'idle', failure: null, index: 0, part: null });
  const [revealedIndex, setRevealedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<RehearsalEngine | null>(null);
  const speakerRef = useRef<WebSpeechSpeaker | null>(null);

  // Valori letti dal motore al momento di ogni frase, senza ricrearlo.
  const live = useRef({ settings, voices, prefs, onChange });
  useEffect(() => {
    live.current = { settings, voices, prefs, onChange };
  });

  // Solo per la visualizzazione delle parti della battuta (nessuna voce, nessun ref).
  const display: Director = useMemo(
    () => createDirector(script, plan, () => DEFAULT_PACING, () => ({ voiceURI: null, rate: 1, pitch: 1 })),
    [script, plan],
  );

  const infos = useMemo(() => voices.map(toInfo), [voices]);
  const noVoice = speechSupported() && voicesReady && !resolveVoice(undefined, infos, prefs.strictPrivacy, appLang());
  // Voci scelte dall'attore che mancano su questo dispositivo: lo si dice, senza sostituirle in silenzio.
  const counts = useMemo(() => lineCounts(script), [script]);
  const missing = voicesReady
    ? Object.entries(
        scriptVoices(script.characters, settings, infos, prefs, counts).byId,
      )
        .filter(([, a]) => a.source === 'missing')
        .map(([id, a]) => ({
          name: script.characters.find((c) => c.id === id)?.name ?? '',
          chosen: settings.voices[id]?.voiceName,
          now: infos.find((v) => v.uri === a.voiceURI)?.name ?? 'nessuna voce',
        }))
    : [];

  useEffect(() => {
    const { settings: st } = live.current;
    const startIndex = Math.max(0, plan.findIndex((p) => p.blockIndex >= st.position));
    const speaker = speechSupported() ? new WebSpeechSpeaker(() => live.current.voices, setError) : null;
    const counts = lineCounts(script);
    const director = createDirector(
      script,
      plan,
      () => ({ ...DEFAULT_PACING, ...live.current.settings.pacing }),
      (character, narrator) => {
        const { settings: s, voices: v, prefs: p } = live.current;
        const infos = v.map(toInfo);
        // Stessa assegnazione mostrata nella scheda Voci: voci diverse, scelte dell'attore rispettate.
        if (!narrator && character) {
          const a = scriptVoices(script.characters, s, infos, p, counts).byId[character];
          if (a?.voiceURI) return { voiceURI: a.voiceURI, rate: a.rate, pitch: a.pitch };
        }
        const setting = narrator ? s.narrator : character ? s.voices[character] : undefined;
        return resolveVoice(setting, infos, p.strictPrivacy, appLang()) ?? { voiceURI: null, rate: 1, pitch: 1 };
      },
    );
    speakerRef.current = speaker;
    const engine = new RehearsalEngine(plan, {
      speaker: speaker ?? { speak: async () => 'cancelled' as const, cancel() {} },
      timer: realTimer(),
      stepsOf: director.stepsOf,
      voiceOf: director.voiceOf,
      onChange: (s) => {
        setState(s);
        const item = plan[s.index];
        if (item) live.current.onChange({ position: item.blockIndex });
      },
    });
    engineRef.current = engine;
    // Notifica lo stato iniziale tramite onChange.
    engine.goTo(startIndex, false);
    return () => engine.stop();
  }, [plan, script]);

  const act = (fn: (e: RehearsalEngine) => void) => {
    setError(null);
    // Sblocca la sintesi vocale dentro il gesto dell'utente (necessario su iOS).
    speakerRef.current?.prime();
    if (engineRef.current) fn(engineRef.current);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine || (e.target as HTMLElement).closest('input, select, textarea, button, summary')) return;
      speakerRef.current?.prime();
      if (e.key === ' ') {
        e.preventDefault();
        if (engine.state.status === 'speaking' || engine.state.status === 'starting') engine.pause();
        else engine.continue();
      } else if (e.key === 'ArrowRight') engine.next();
      else if (e.key === 'ArrowLeft') engine.previous();
      else if (e.key.toLowerCase() === 'r') engine.repeat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Prova in corso (anche in pausa o in attesa della battuta dell'attore): nessun aggiornamento dell'app.
  const active = state.status !== 'idle' && state.status !== 'finished';
  useEffect(() => {
    setBusy('prova', active);
    return () => setBusy('prova', false);
  }, [active]);

  const setPacing = (patch: Partial<PacingSettings>) => onChange({ pacing: { ...pacing, ...patch } });

  const scenes = script.blocks.filter((b) => b.kind === 'heading');
  const item = plan[state.index];
  const block = item ? script.blocks[item.blockIndex] : undefined;
  const parts = item ? display.parts(state.index) : [];
  const context = item
    ? script.blocks
        .slice(0, item.blockIndex)
        .filter((b) => b.kind !== 'front' && b.kind !== 'cast')
        .slice(-2)
    : [];
  const hidden = mode === 'memorize' && item?.actor && revealedIndex !== state.index;
  const actorNext = role && mode !== 'full' ? nextActorIndex(plan, item?.actor ? state.index + 1 : state.index) : -1;
  const actorBlock = actorNext >= 0 ? script.blocks[plan[actorNext]!.blockIndex] : undefined;
  const speakerName = block ? (item?.narrator ? 'Didascalia' : speakerLabel(script, block.speakers)) : '';
  const roleName = script.characters.find((c) => c.id === role)?.name;

  const statusText = (() => {
    switch (state.status) {
      case 'starting':
        return item?.narrator ? 'Avvio della voce narrante…' : `Avvio della voce: ${speakerName}…`;
      case 'speaking':
        return item?.narrator ? 'Lettura della didascalia' : `Sta parlando: ${speakerName}`;
      case 'failed':
        return state.failure === 'timeout' ? 'Voce non avviata' : 'Errore della voce';
      case 'waiting':
        return `Tocca a te${roleName ? ` — ${roleName}` : ''}. Recita, poi premi Continua.`;
      case 'paused':
        return 'In pausa';
      case 'finished':
        return 'Fine della parte selezionata';
      default:
        return 'Pronto';
    }
  })();

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

        <details className="rhythm">
          <summary>Ritmo della prova</summary>
          <label className="field">
            Ritmo generale: {pacing.tempo < 0.9 ? 'disteso' : pacing.tempo > 1.1 ? 'serrato' : 'naturale'}
            <input
              type="range"
              min={TEMPO_MIN}
              max={TEMPO_MAX}
              step={0.05}
              value={pacing.tempo}
              onChange={(e) => setPacing({ tempo: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Pausa tra un personaggio e l’altro: {fmtSeconds(pacing.speakerPauseMs)}
            <input
              type="range"
              min={0}
              max={1500}
              step={50}
              value={pacing.speakerPauseMs}
              onChange={(e) => setPacing({ speakerPauseMs: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Pausa dopo la tua battuta: {fmtSeconds(pacing.afterActorPauseMs)}
            <input
              type="range"
              min={0}
              max={1500}
              step={50}
              value={pacing.afterActorPauseMs}
              onChange={(e) => setPacing({ afterActorPauseMs: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={pacing.readDirections}
              onChange={(e) => setPacing({ readDirections: e.target.checked })}
            />
            Leggi anche le didascalie (voce narrante, impostabile in Voci)
          </label>
          <p className="hint">
            Il ritmo agisce soprattutto sulle pause tra frasi e tra personaggi; la velocità delle voci cambia solo di
            poco. Dopo una battuta interrotta (“—” o “…”) il personaggio successivo attacca subito.
          </p>
          <button className="btn ghost" onClick={() => onChange({ pacing: { ...DEFAULT_PACING } })}>
            Ripristina il ritmo predefinito
          </button>
        </details>
      </section>

      {!speechSupported() && <p className="alert">Questo browser non supporta la sintesi vocale.</p>}
      {noVoice && (
        <p className="alert">
          Nessuna voce locale disponibile in privacy rigorosa. Installa una voce nel sistema o modifica l’impostazione
          nella sezione Voci.
        </p>
      )}
      {missing.map((m) => (
        <p key={m.name} className="notice">
          La voce scelta per {m.name}
          {m.chosen ? ` (${m.chosen})` : ''} non è disponibile su questo dispositivo: per ora legge {m.now}. Puoi
          cambiarla nella sezione Voci.
        </p>
      ))}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {state.status === 'failed' && state.failure === 'timeout' && (
        <p className="alert" role="alert">
          Il browser non ha avviato la voce entro {START_TIMEOUT_MS / 1000} secondi: la battuta non è stata letta e la
          prova è ferma su questa frase. Premi «Riprova». Se si ripete, chiudi completamente il browser (su Mac: Cmd+Q)
          e riaprilo: a volte il motore vocale resta bloccato finché il browser non viene riavviato. I dettagli sono
          nella sezione Diagnostica della scheda Voci.
        </p>
      )}

      <section className={`stage ${state.status}`} aria-live="polite">
        <div className="stage-status">
          <span className="status-label">{statusText}</span>
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
            {context.length > 0 && (
              <div className="context">
                {context.map((b) => (
                  <p key={b.id} className={`ctx ${b.kind}`}>
                    {b.kind === 'speech' && <strong>{speakerLabel(script, b.speakers)}: </strong>}
                    {b.text}
                  </p>
                ))}
              </div>
            )}
            {block && (
              <div className={`current ${item?.actor ? 'mine' : ''} ${item?.narrator ? 'narration' : ''}`}>
                <p className="current-speaker">
                  <span className="who">{speakerName}</span>
                  {block.note ? <span className="note"> ({block.note})</span> : null}
                  {block.offstage ? <span className="tag">fuori scena</span> : null}
                  {item?.actor && <span className="badge">La tua battuta</span>}
                </p>
                {hidden ? (
                  <button className="btn reveal" onClick={() => setRevealedIndex(state.index)}>
                    Mostra la battuta
                  </button>
                ) : (
                  <p className="current-text">
                    {parts.map((p, i) => (
                      <span
                        key={i}
                        className={`${p.kind === 'direction' ? 'inline-direction' : 'sentence'}${
                          state.status === 'speaking' && state.part === i ? ' now' : ''
                        }`}
                      >
                        {p.text}{' '}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {actorBlock && actorNext !== state.index && (
        <section className="next-mine" aria-label="La tua prossima battuta">
          <p className="next-mine-label">
            La tua prossima battuta
            {actorNext - state.index === 1 ? ' — subito dopo' : ` — fra ${actorNext - state.index} battute`}
          </p>
          {mode === 'memorize' ? (
            <p className="next-mine-text muted">(nascosta in modalità Memoria)</p>
          ) : (
            <p className="next-mine-text">{actorBlock.text}</p>
          )}
        </section>
      )}

      <section className="controls" aria-label="Comandi della prova">
        {state.status === 'speaking' || state.status === 'starting' ? (
          <button className="btn large" onClick={() => act((e) => e.pause())}>
            Pausa
          </button>
        ) : state.status === 'failed' ? (
          <button className="btn primary large" onClick={() => act((e) => e.continue())}>
            Riprova
          </button>
        ) : state.status === 'paused' || state.status === 'waiting' ? (
          <button className="btn primary large" onClick={() => act((e) => e.continue())}>
            Continua
          </button>
        ) : (
          <button
            className="btn primary large"
            onClick={() => act((e) => e.start())}
            disabled={plan.length === 0 || noVoice}
          >
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
      <p className="hint center">
        Da tastiera: Spazio avvia/pausa/continua, frecce per spostarsi, R per ripetere. Sul tuo turno, “Ripeti” fa
        riascoltare la battuta d’attacco.
      </p>
    </div>
  );
}
