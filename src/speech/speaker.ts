import type { SpeakOptions, SpeakResult, Speaker } from '../rehearsal/engine';
import { logSpeech } from './diagnostics';

/** Ritardo dopo cancel(): Chrome può scartare un enunciato avviato subito dopo. */
const AFTER_CANCEL_MS = 80;
/** Attesa massima della fine dell'enunciato di sblocco. */
const PRIME_TIMEOUT_MS = 1000;
/** Se l'evento "start" non arriva entro questo tempo, la voce non è partita: è un errore. */
export const START_TIMEOUT_MS = 5000;

/** Implementazione di Speaker basata sulla Web Speech API del browser. */
export class WebSpeechSpeaker implements Speaker {
  /** Riferimento all'enunciazione in corso: evita che Safari la perda (e non emetta "end"). */
  private current: { utterance: SpeechSynthesisUtterance; finish: (r: SpeakResult) => void } | null = null;
  private lastCancel = 0;
  private primed = false;
  /** Enunciato di sblocco in corso: non va annullato. */
  private priming: Promise<void> | null = null;
  /** Cresce a ogni cancel(): una frase in attesa di partire viene scartata. */
  private generation = 0;

  constructor(
    private readonly getVoices: () => SpeechSynthesisVoice[],
    private readonly onError?: (message: string) => void,
  ) {}

  /**
   * Da chiamare dentro un gesto dell'utente (tocco, clic): su iOS la sintesi
   * vocale si sblocca solo così, e le frasi successive avviate da un timer
   * possono essere pronunciate.
   *
   * L'enunciato di sblocco non viene mai annullato: in Chrome su macOS
   * annullarlo prima che inizi blocca la sintesi vocale per tutta la pagina.
   * Le frasi successive attendono che sia terminato.
   */
  prime(): void {
    if (this.primed) return;
    this.primed = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.priming = new Promise((resolve) => {
      const done = (kind: 'sblocco-fine' | 'sblocco-timeout') => {
        if (!this.priming) return;
        clearTimeout(timer);
        this.priming = null;
        logSpeech({ kind });
        resolve();
      };
      const timer = setTimeout(() => done('sblocco-timeout'), PRIME_TIMEOUT_MS);
      u.onend = () => done('sblocco-fine');
      u.onerror = () => done('sblocco-fine');
    });
    logSpeech({ kind: 'sblocco' });
    window.speechSynthesis.speak(u);
  }

  /**
   * Pronuncia una frase. `onStart` viene chiamato solo quando il browser
   * conferma l'avvio dell'audio. Se l'avvio non arriva entro START_TIMEOUT_MS
   * il risultato è 'stalled': la frase non viene considerata pronunciata.
   */
  async speak(text: string, opts: SpeakOptions, onStart?: () => void): Promise<SpeakResult> {
    const synth = window.speechSynthesis;
    if (this.priming) {
      const gen = this.generation;
      await this.priming;
      if (gen !== this.generation) return 'cancelled';
    }
    if (synth.speaking || synth.pending) {
      synth.cancel();
      this.lastCancel = Date.now();
    }
    const gen = this.generation;
    const since = Date.now() - this.lastCancel;
    if (since < AFTER_CANCEL_MS) await new Promise((r) => setTimeout(r, AFTER_CANCEL_MS - since));
    if (gen !== this.generation) return 'cancelled';
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = this.getVoices().find((v) => v.voiceURI === opts.voiceURI);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = opts.rate;
      u.pitch = opts.pitch;
      const info = voice ? { voice: voice.name, local: voice.localService } : { voice: '(predefinita)' };

      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const startTimer = setTimeout(() => {
        logSpeech({ kind: 'timeout-avvio', ...info });
        finish('stalled');
      }, START_TIMEOUT_MS);
      const finish = (r: SpeakResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        clearTimeout(watchdog);
        if (this.current?.utterance === u) this.current = null;
        resolve(r);
      };
      u.onstart = () => {
        if (settled) {
          // Partita in ritardo, quando la frase era già stata data per non avviata.
          synth.cancel();
          return;
        }
        clearTimeout(startTimer);
        logSpeech({ kind: 'avvio', ...info });
        onStart?.();
        // Rete di sicurezza: a volte, dopo l'avvio, il browser non emette "end".
        watchdog = setTimeout(
          () => {
            logSpeech({ kind: 'fine-presunta', ...info });
            finish('end');
          },
          6000 + (text.length * 150) / Math.max(0.5, opts.rate),
        );
      };
      u.onend = () => {
        if (!settled) logSpeech({ kind: 'fine', ...info });
        finish('end');
      };
      u.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') {
          if (!settled) logSpeech({ kind: 'annullata', ...info, code: e.error });
          return finish('cancelled');
        }
        logSpeech({ kind: 'errore', ...info, code: e.error });
        this.onError?.(
          e.error === 'not-allowed'
            ? 'Il browser ha bloccato la voce: tocca di nuovo il pulsante.'
            : `La sintesi vocale ha restituito un errore (${e.error}).`,
        );
        finish('error');
      };
      this.current = { utterance: u, finish };
      logSpeech({ kind: 'richiesta', ...info, chars: text.length });
      synth.resume();
      synth.speak(u);
    });
  }

  cancel(): void {
    this.generation++;
    const c = this.current;
    this.current = null;
    const synth = window.speechSynthesis;
    // Durante lo sblocco non c'è altro da annullare: lo si lascia terminare.
    if (c || (!this.priming && (synth.speaking || synth.pending))) {
      synth.cancel();
      this.lastCancel = Date.now();
    }
    if (c) logSpeech({ kind: 'annullata' });
    c?.finish('cancelled');
  }
}
