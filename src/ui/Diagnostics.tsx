import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  browserLabel,
  buildReport,
  lastImportFailure,
  snapshot,
  speechEvents,
  subscribe,
  synthState,
} from '../speech/diagnostics';
import { START_TIMEOUT_MS, WebSpeechSpeaker } from '../speech/speaker';
import { appLang, loadVoices, resolveVoice, speechSupported, toInfo } from '../speech/voices';
import type { GlobalPrefs } from '../types';

interface Props {
  prefs: GlobalPrefs;
}

/**
 * Diagnostica locale, da copiare in una segnalazione. Contiene solo dati
 * tecnici: mai testo dei copioni, nomi dei personaggi o dati personali.
 */
export default function Diagnostics({ prefs }: Props) {
  useSyncExternalStore(subscribe, snapshot);
  const [sw, setSw] = useState(() => ('serviceWorker' in navigator ? 'verifica…' : 'non supportato'));
  const [test, setTest] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  const [speaker] = useState(() =>
    speechSupported() ? new WebSpeechSpeaker(() => window.speechSynthesis.getVoices()) : null,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const infos = useMemo(() => voices.map(toInfo), [voices]);

  useEffect(() => {
    if (!speechSupported()) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    void loadVoices().then(setVoices);
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.getRegistration().then((r) => {
      setSw(
        !r
          ? 'non registrato'
          : `${r.active ? 'attivo' : 'non attivo'}${r.waiting ? ', nuova versione in attesa' : ''}${
              navigator.serviceWorker.controller ? '' : ', pagina non controllata'
            }`,
      );
    });
  }, []);

  const report = buildReport({
    appVersion: __APP_VERSION__,
    browser: browserLabel(navigator.userAgent),
    serviceWorker: sw,
    strictPrivacy: prefs.strictPrivacy,
    lang: appLang(),
    voices: infos,
    events: speechEvents(),
    importFailure: lastImportFailure(),
    synth: synthState(),
  });

  const tryVoice = () => {
    const resolved = resolveVoice(undefined, infos, prefs.strictPrivacy, appLang());
    if (!speaker || !resolved) return setTest('Nessuna voce utilizzabile.');
    setTest('Avvio della voce…');
    void speaker.speak('Prova della voce.', resolved, () => setTest('In riproduzione')).then((r) =>
      setTest(
        r === 'end'
          ? 'Prova completata: la voce funziona.'
          : r === 'stalled'
            ? `Nessun audio entro ${START_TIMEOUT_MS / 1000} secondi: il motore vocale del browser non risponde.`
            : r === 'error'
              ? 'Errore della sintesi vocale (vedi eventi).'
              : 'Prova interrotta.',
      ),
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      // Ripiego: selezione del testo e copia classica.
      const range = document.createRange();
      if (pre.current) range.selectNodeContents(pre.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <details className="panel diag">
      <summary>Diagnostica (voce e importazione)</summary>
      <p className="hint">
        Dati tecnici del browser e dell’app, utili per una segnalazione. Non contiene testo dei copioni, nomi dei
        personaggi o dati personali, e non viene inviato a nessuno: puoi copiarlo e incollarlo tu.
      </p>
      <div className="row wrap">
        <button className="btn" onClick={tryVoice} disabled={!speaker}>
          Prova la voce
        </button>
        <button className="btn" onClick={() => void copy()}>
          {copied ? 'Copiato' : 'Copia il rapporto'}
        </button>
      </div>
      {test && (
        <p className="preview-result" role="status">
          {test}
        </p>
      )}
      <pre ref={pre}>{report}</pre>
    </details>
  );
}
