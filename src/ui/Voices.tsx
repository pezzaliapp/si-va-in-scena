import { useMemo, useState } from 'react';
import { lineCounts } from '../script/edit';
import { START_TIMEOUT_MS, WebSpeechSpeaker } from '../speech/speaker';
import Diagnostics from './Diagnostics';
import { spokenText } from '../script/segments';
import {
  appLang,
  autoAssign,
  resolveVoice,
  sortVoices,
  speechSupported,
  toInfo,
  usableVoices,
} from '../speech/voices';
import type { GlobalPrefs, Script, ScriptSettings, VoiceSetting } from '../types';

interface Props {
  script: Script;
  settings: ScriptSettings;
  voices: SpeechSynthesisVoice[];
  prefs: GlobalPrefs;
  onPrefs(p: GlobalPrefs): void;
  onChange(patch: Partial<ScriptSettings>): void;
  onDone(): void;
}

export default function Voices({ script, settings, voices, prefs, onPrefs, onChange, onDone }: Props) {
  const [shared, setShared] = useState<boolean | null>(null);
  // Esito dell'ultima anteprima, mostrato accanto al pulsante.
  const [result, setResult] = useState<{ id: string; text: string; bad: boolean } | null>(null);
  const [speaker] = useState(() =>
    speechSupported() ? new WebSpeechSpeaker(() => window.speechSynthesis.getVoices()) : null,
  );
  const lang = appLang();
  const infos = useMemo(() => voices.map(toInfo), [voices]);
  const usable = useMemo(() => sortVoices(usableVoices(infos, prefs.strictPrivacy), lang), [infos, prefs, lang]);
  const counts = useMemo(() => lineCounts(script), [script]);
  const remoteCount = infos.filter((v) => !v.local).length;
  const others = script.characters.filter((c) => c.id !== settings.role);

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

  const auto = () => {
    const r = autoAssign(script.characters, settings.role, usable, lang);
    onChange({ voices: r.voices });
    setShared(r.shared);
  };

  const preview = (id: string) => {
    const resolved = resolveVoice(settings.voices[id], infos, prefs.strictPrivacy, lang);
    if (!resolved || !speaker) return;
    const sample =
      script.blocks.map((b) => (b.speakers.includes(id) ? spokenText(b.text) : '')).find((t) => t.length > 0) ??
      'Si va in scena.';
    const show = (text: string, bad = false) => setResult({ id, text, bad });
    show('Avvio della voce…');
    void speaker
      .speak(sample.slice(0, 160), resolved, () => show('In riproduzione'))
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
          Le voci sono quelle installate su questo dispositivo: {infos.length} in totale, {usable.length} utilizzabili
          {prefs.strictPrivacy ? ' in privacy rigorosa' : ''}. Il numero e la qualità dipendono dal sistema operativo e
          dal browser.
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
        <button className="btn" onClick={auto} disabled={usable.length === 0}>
          Assegna voci automaticamente
        </button>
        {shared && (
          <p className="notice">
            Le voci disponibili sono meno dei personaggi: alcune sono condivise e distinte solo dall’intonazione.
          </p>
        )}
      </section>

      <section className="panel">
        <ul className="voice-list">
          {others.map((c) => {
            const v = settings.voices[c.id] ?? { voiceURI: null, rate: 1, pitch: 1 };
            const selected = usable.some((u) => u.uri === v.voiceURI) ? v.voiceURI! : '';
            return (
              <li key={c.id} className="voice-row">
                <div className="row spread">
                  <strong>{c.name}</strong>
                  <span className="count">{counts.get(c.id) ?? 0} battute</span>
                </div>
                <select
                  className="select"
                  value={selected}
                  aria-label={`Voce di ${c.name}`}
                  onChange={(e) => setVoice(c.id, { voiceURI: e.target.value || null })}
                >
                  <option value="">Voce predefinita</option>
                  {usable.map((u) => (
                    <option key={u.uri} value={u.uri}>
                      {u.name} ({u.lang}){u.local ? '' : ' · rete'}
                    </option>
                  ))}
                </select>
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
                    Intonazione {v.pitch.toFixed(1)}
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.1}
                      value={v.pitch}
                      onChange={(e) => setVoice(c.id, { pitch: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <button className="btn" onClick={() => preview(c.id)} disabled={usable.length === 0}>
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
            value={usable.some((u) => u.uri === settings.narrator?.voiceURI) ? settings.narrator!.voiceURI! : ''}
            aria-label="Voce narrante"
            onChange={(e) =>
              onChange({ narrator: { rate: 1, pitch: 1, ...settings.narrator, voiceURI: e.target.value || null } })
            }
          >
            <option value="">Voce predefinita</option>
            {usable.map((u) => (
              <option key={u.uri} value={u.uri}>
                {u.name} ({u.lang}){u.local ? '' : ' · rete'}
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
