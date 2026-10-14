import { useMemo, useState } from 'react';
import { lineCounts, setCharacterVoice } from '../script/edit';
import { spokenText } from '../script/segments';
import { START_TIMEOUT_MS, WebSpeechSpeaker } from '../speech/speaker';
import {
  appLang,
  findVoice,
  scriptVoices,
  sortVoices,
  speechSupported,
  toInfo,
  usableVoices,
  voiceGender,
  type VoiceInfo,
} from '../speech/voices';
import type { GlobalPrefs, Script, ScriptSettings, VoiceGender, VoiceSetting } from '../types';
import Diagnostics from './Diagnostics';

interface Props {
  script: Script;
  settings: ScriptSettings;
  voices: SpeechSynthesisVoice[];
  /** L'elenco delle voci del browser è completo (vedi `loadVoices`). */
  voicesReady: boolean;
  prefs: GlobalPrefs;
  onPrefs(p: GlobalPrefs): void;
  onChange(patch: Partial<ScriptSettings>): void;
  onScript(s: Script): void;
  onDone(): void;
}

const GENDER_LABEL: Record<VoiceGender, string> = { m: 'maschile', f: 'femminile' };

export default function Voices({
  script,
  settings,
  voices,
  voicesReady,
  prefs,
  onPrefs,
  onChange,
  onScript,
  onDone,
}: Props) {
  // Esito dell'ultima anteprima, mostrato accanto al pulsante.
  const [result, setResult] = useState<{ id: string; text: string; bad: boolean } | null>(null);
  const [speaker] = useState(() =>
    speechSupported() ? new WebSpeechSpeaker(() => window.speechSynthesis.getVoices()) : null,
  );
  const lang = appLang();
  const prefix = lang.slice(0, 2).toLowerCase();
  const infos = useMemo(() => voices.map(toInfo), [voices]);
  const usable = sortVoices(usableVoices(infos, prefs.strictPrivacy), lang);
  const counts = useMemo(() => lineCounts(script), [script]);
  const genders = prefs.voiceGenders;
  const assignment = scriptVoices(script.characters, settings, infos, prefs, counts);
  const remoteCount = infos.filter((v) => !v.local).length;
  const localCount = infos.filter((v) => v.local).length;
  const others = script.characters.filter((c) => c.id !== settings.role);
  const poolIsLang = assignment.pool.some((v) => v.lang.toLowerCase().startsWith(prefix));
  const manualCount = others.filter((c) => assignment.byId[c.id]?.source === 'manual').length;
  const nameOf = (uri: string | null) => usable.find((v) => v.uri === uri)?.name ?? 'nessuna voce';
  const genderOf = (uri: string | null) => {
    const v = uri ? usable.find((x) => x.uri === uri) : undefined;
    return v ? voiceGender(v, genders) : null;
  };
  const label = (v: VoiceInfo) => {
    const g = voiceGender(v, genders);
    const gl = g ? ` · ${GENDER_LABEL[g.gender]}${g.source === 'known' ? ' (suggerito)' : ''}` : '';
    return `${v.name} (${v.lang})${gl}${v.local ? '' : ' · rete'}`;
  };

  if (!speechSupported()) {
    return (
      <section className="panel">
        <h2>Voci</h2>
        <p className="alert">
          Questo browser non supporta la sintesi vocale. Puoi comunque usare la modalità Studio, oppure aprire l’app con
          Safari, Chrome, Edge o Firefox aggiornati.
        </p>
      </section>
    );
  }

  const setVoice = (id: string, patch: Partial<VoiceSetting>) => {
    const current = settings.voices[id] ?? { voiceURI: null, rate: 1, pitch: 1 };
    onChange({ voices: { ...settings.voices, [id]: { ...current, ...patch } } });
  };

  // Si salvano anche nome e lingua: ritrovano la voce se l'identificatore cambia.
  const chooseVoice = (id: string, uri: string) => {
    const v = usable.find((x) => x.uri === uri);
    setVoice(id, { voiceURI: v?.uri ?? null, voiceName: v?.name, voiceLang: v?.lang });
  };

  const setGender = (uri: string, g: VoiceGender | null) => {
    const next = { ...genders };
    if (g) next[uri] = g;
    else delete next[uri];
    onPrefs({ ...prefs, voiceGenders: next });
  };

  const resetAll = () => {
    if (confirm('Tornare alle voci proposte automaticamente per tutti i personaggi? Le tue scelte verranno rimosse.')) {
      onChange({ voices: {} });
    }
  };

  const preview = (id: string) => {
    const a = assignment.byId[id];
    if (!a?.voiceURI || !speaker) return;
    const sample =
      script.blocks.map((b) => (b.speakers.includes(id) ? spokenText(b.text) : '')).find((t) => t.length > 0) ??
      'Si va in scena.';
    const show = (text: string, bad = false) => setResult({ id, text, bad });
    show('Avvio della voce…');
    void speaker
      .speak(sample.slice(0, 160), a, () => show('In riproduzione'))
      .then((r) => {
        setResult((cur) => {
          if (cur?.id !== id) return cur;
          if (r === 'end') return { id, text: 'Anteprima completata', bad: false };
          if (r === 'stalled')
            return {
              id,
              text: `Nessun audio: il browser non ha avviato la voce entro ${START_TIMEOUT_MS / 1000} secondi. Se si ripete, chiudi completamente il browser e riaprilo (vedi Diagnostica).`,
              bad: true,
            };
          if (r === 'error') return { id, text: 'Errore della sintesi vocale (vedi Diagnostica).', bad: true };
          return null;
        });
      });
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2>Voci dei personaggi</h2>
        <p className="hint">
          Voci {poolIsLang && prefix === 'it' ? 'italiane ' : ''}
          {prefs.strictPrivacy ? 'locali ' : ''}utilizzabili: <strong>{assignment.pool.length}</strong> (su {localCount}{' '}
          voci locali e {infos.length} in totale su questo dispositivo). Il numero e la qualità dipendono dal sistema
          operativo e dal browser.
        </p>
        <label className="check strong">
          <input
            type="checkbox"
            checked={prefs.strictPrivacy}
            onChange={(e) => onPrefs({ ...prefs, strictPrivacy: e.target.checked })}
          />
          Privacy rigorosa: usa solo voci elaborate sul dispositivo
        </label>
        <p className="hint">
          {prefs.strictPrivacy
            ? remoteCount > 0
              ? `${remoteCount} voci di rete sono escluse: con queste il testo delle battute verrebbe inviato al fornitore della voce.`
              : 'Nessuna voce di rete rilevata.'
            : 'Attenzione: con le voci di rete il testo delle battute viene inviato al fornitore del browser per essere letto.'}
        </p>
        {usable.length === 0 && (
          <p className="alert">
            Nessuna voce locale disponibile. Puoi installare voci aggiuntive dalle impostazioni del sistema operativo
            (vedi la guida nel README) oppure disattivare la privacy rigorosa.
          </p>
        )}
        {assignment.shared && (
          <p className="notice">
            {assignment.pool.length} voci {poolIsLang && prefix === 'it' ? 'italiane ' : ''}per {others.length}{' '}
            personaggi: alcune voci vengono riutilizzate con un’intonazione diversa. Le altre voci del dispositivo sono
            in altre lingue; installando altre voci italiane nel sistema i personaggi saranno più distinguibili.
          </p>
        )}
        <p className="hint">
          Ogni personaggio riceve una voce diversa, proposta automaticamente; puoi cambiarla quando vuoi. Indica per
          ciascun personaggio se preferisci una voce maschile o femminile: l’app non lo deduce dal nome e, finché non lo
          indichi, le voci sono solo diverse tra loro, non scelte per genere. Il browser non dice se una voce è maschile
          o femminile: per le voci italiane di sistema più comuni l’app propone un’indicazione iniziale ricavata dal
          nome della voce, non verificata, che puoi correggere dopo l’anteprima. Le tue scelte restano salvate su questo
          dispositivo.
        </p>
        {manualCount > 0 && (
          <button className="btn ghost" onClick={resetAll}>
            Torna alle voci proposte ({manualCount} {manualCount === 1 ? 'scelta tua' : 'scelte tue'})
          </button>
        )}
      </section>

      {!voicesReady && (
        <p className="panel hint" aria-busy="true">
          Caricamento dell’elenco delle voci…
        </p>
      )}
      <section className="panel" hidden={!voicesReady}>
        <ul className="voice-list">
          {others.map((c) => {
            const a = assignment.byId[c.id];
            const v = settings.voices[c.id] ?? { voiceURI: null, rate: 1, pitch: 1 };
            const current = a?.voiceURI ?? null;
            const vg = genderOf(current);
            const g = vg?.gender;
            return (
              <li key={c.id} className="voice-row">
                <div className="row spread">
                  <strong>{c.name}</strong>
                  <span className="count">
                    {counts.get(c.id) ?? 0} {counts.get(c.id) === 1 ? 'battuta' : 'battute'}
                  </span>
                </div>
                <div className="row wrap gender">
                  <span className="hint">Voce per {c.name}:</span>
                  {(['m', 'f'] as const).map((x) => (
                    <button
                      key={x}
                      className={`btn ghost${c.voice === x ? ' active' : ''}`}
                      aria-pressed={c.voice === x}
                      onClick={() => onScript(setCharacterVoice(script, c.id, c.voice === x ? undefined : x))}
                    >
                      {GENDER_LABEL[x]}
                    </button>
                  ))}
                  {!c.voice && <span className="hint">da scegliere</span>}
                </div>
                <select
                  className="select"
                  value={a?.source === 'manual' ? current! : ''}
                  aria-label={`Voce di ${c.name}`}
                  onChange={(e) =>
                    e.target.value ? chooseVoice(c.id, e.target.value) : setVoice(c.id, { voiceURI: null })
                  }
                >
                  <option value="">
                    Automatica
                    {a?.source !== 'manual' && current ? `: ${nameOf(current)}` : ''}
                  </option>
                  {usable.map((u) => (
                    <option key={u.uri} value={u.uri}>
                      {label(u)}
                    </option>
                  ))}
                </select>
                {a?.source === 'missing' && (
                  <p className="notice">
                    La voce scelta per {c.name}
                    {settings.voices[c.id]?.voiceName ? ` (${settings.voices[c.id]!.voiceName})` : ''} non è disponibile
                    su questo dispositivo: la scelta resta salvata e tornerà in uso dove la voce c’è. Per ora è proposta{' '}
                    {nameOf(current)}.
                  </p>
                )}
                {a?.unverified && c.voice && (
                  <p className="preview-result">
                    Per {c.name} hai chiesto una voce {GENDER_LABEL[c.voice]}
                    {g
                      ? `, ma ${nameOf(current)} è indicata come ${GENDER_LABEL[g]}: scegli un’altra voce o correggi l’indicazione.`
                      : `: non sappiamo se ${nameOf(current)} lo sia. Ascolta l’anteprima e indicalo qui sotto, oppure scegli un’altra voce.`}
                  </p>
                )}
                {current && (
                  <div className="row wrap gender">
                    <span className="hint">
                      {nameOf(current)} è una voce
                      {vg?.source === 'known'
                        ? ' (suggerimento dal nome della voce, non verificato: correggilo se all’ascolto non corrisponde)'
                        : ''}
                      :
                    </span>
                    {(['m', 'f'] as const).map((x) => (
                      <button
                        key={x}
                        className={`btn ghost${g === x ? ' active' : ''}`}
                        aria-pressed={g === x}
                        onClick={() => setGender(current, vg?.source === 'user' && g === x ? null : x)}
                      >
                        {GENDER_LABEL[x]}
                      </button>
                    ))}
                  </div>
                )}
                <div className="sliders">
                  <label className="field">
                    Velocità {v.rate.toFixed(1)}
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={v.rate}
                      onChange={(e) => setVoice(c.id, { rate: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    Intonazione {(a?.pitch ?? v.pitch).toFixed(2)}
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={a?.pitch ?? v.pitch}
                      onChange={(e) => setVoice(c.id, { pitch: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <button className="btn" onClick={() => preview(c.id)} disabled={!current}>
                  Ascolta anteprima
                </button>
                {result?.id === c.id && (
                  <p className={`preview-result${result.bad ? ' bad' : ''}`} role="status">
                    {result.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <div className="voice-row">
          <div className="row spread">
            <strong>Voce narrante</strong>
            <span className="count">didascalie, se attivata la lettura</span>
          </div>
          <select
            className="select"
            value={findVoice(settings.narrator, usable)?.uri ?? ''}
            aria-label="Voce narrante"
            onChange={(e) =>
              onChange({
                narrator: {
                  rate: 1,
                  pitch: 1,
                  ...settings.narrator,
                  voiceURI: e.target.value || null,
                  voiceName: usable.find((u) => u.uri === e.target.value)?.name,
                  voiceLang: usable.find((u) => u.uri === e.target.value)?.lang,
                },
              })
            }
          >
            <option value="">Prima voce disponibile</option>
            {usable.map((u) => (
              <option key={u.uri} value={u.uri}>
                {label(u)}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">L’intonazione non è supportata da tutte le voci: su alcuni sistemi non ha effetto.</p>
      </section>

      <Diagnostics prefs={prefs} />

      <button className="btn primary large block" onClick={onDone}>
        Vai alla prova
      </button>
    </div>
  );
}
