import type { SpeakOptions, Speaker } from '../rehearsal/engine';

/** Implementazione di Speaker basata sulla Web Speech API del browser. */
export class WebSpeechSpeaker implements Speaker {
  /** Riferimento all'enunciazione in corso: evita che Safari la perda (e non emetta "end"). */
  private current: { utterance: SpeechSynthesisUtterance; finish: (r: 'end' | 'cancelled') => void } | null = null;

  constructor(
    private readonly getVoices: () => SpeechSynthesisVoice[],
    private readonly onError?: (message: string) => void,
  ) {}

  speak(text: string, opts: SpeakOptions): Promise<'end' | 'cancelled'> {
    const synth = window.speechSynthesis;
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = this.getVoices().find((v) => v.voiceURI === opts.voiceURI);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = opts.rate;
      u.pitch = opts.pitch;

      let settled = false;
      // Rete di sicurezza: alcuni browser a volte non emettono "end".
      const watchdog = setTimeout(() => finish('end'), 6000 + (text.length * 150) / Math.max(0.5, opts.rate));
      const finish = (r: 'end' | 'cancelled') => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (this.current?.utterance === u) this.current = null;
        resolve(r);
      };
      u.onend = () => finish('end');
      u.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          this.onError?.(
            e.error === 'not-allowed'
              ? 'Il browser ha bloccato la voce: tocca di nuovo "Avvia" o "Continua".'
              : `La sintesi vocale ha restituito un errore (${e.error}).`,
          );
        }
        finish('cancelled');
      };
      this.current = { utterance: u, finish };
      if (synth.speaking || synth.pending) synth.cancel();
      synth.resume();
      synth.speak(u);
    });
  }

  cancel(): void {
    const c = this.current;
    this.current = null;
    window.speechSynthesis.cancel();
    c?.finish('cancelled');
  }
}

/** Anteprima di una voce (fuori dal motore di prova). */
export function previewVoice(voice: SpeechSynthesisVoice | undefined, text: string, rate: number, pitch: number): void {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  u.rate = rate;
  u.pitch = pitch;
  synth.speak(u);
}
