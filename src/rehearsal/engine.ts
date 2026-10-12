import type { Arrival, Step } from '../pacing/pacing';
import type { PlanItem } from './plan';

export interface SpeakOptions {
  voiceURI: string | null;
  rate: number;
  pitch: number;
}

/** Astrazione della sintesi vocale: permette di provare il motore senza browser. */
export interface Speaker {
  speak(text: string, opts: SpeakOptions): Promise<'end' | 'cancelled'>;
  cancel(): void;
}

/** Attesa annullabile, usata per le pause della regia. */
export interface Timer {
  wait(ms: number): Promise<'end' | 'cancelled'>;
  cancel(): void;
}

export const realTimer = (): Timer => {
  let pending: { id: ReturnType<typeof setTimeout>; resolve: (r: 'end' | 'cancelled') => void } | null = null;
  return {
    wait(ms) {
      return new Promise((resolve) => {
        const id = setTimeout(() => {
          pending = null;
          resolve('end');
        }, ms);
        pending = { id, resolve };
      });
    },
    cancel() {
      if (!pending) return;
      clearTimeout(pending.id);
      pending.resolve('cancelled');
      pending = null;
    },
  };
};

export type Status = 'idle' | 'speaking' | 'paused' | 'waiting' | 'finished';

export interface EngineState {
  status: Status;
  /** Posizione nel piano di prova. */
  index: number;
  /** Parte della battuta corrente in lettura (indice in performBlock), se nota. */
  part: number | null;
}

export interface EngineDeps {
  speaker: Speaker;
  timer: Timer;
  /** Passi da eseguire per la battuta `index`, in base a come ci si arriva. */
  stepsOf(index: number, arrival: Arrival): Step[];
  voiceOf(index: number, step: Extract<Step, { type: 'say' }>): SpeakOptions;
  onChange(state: EngineState): void;
}

/**
 * Motore della prova: esegue frasi e pause delle battute degli altri
 * personaggi e attende senza limiti di tempo sul turno dell'attore, finché
 * non riceve "Continua". Pausa e ripresa ripartono dalla frase interrotta.
 */
export class RehearsalEngine {
  private status: Status = 'idle';
  private index = 0;
  private part: number | null = null;
  private steps: Step[] | null = null;
  private step = 0;
  private run = 0;

  constructor(
    private readonly plan: PlanItem[],
    private readonly deps: EngineDeps,
  ) {}

  get state(): EngineState {
    return { status: this.status, index: this.index, part: this.part };
  }

  /** Avvia la lettura dalla posizione corrente (dall'inizio se il copione è finito). */
  start(): void {
    if (this.plan.length === 0) return this.set('finished');
    this.interrupt();
    if (this.status === 'finished') this.index = 0;
    this.reset();
    void this.loop('user');
  }

  pause(): void {
    if (this.status !== 'speaking') return;
    this.interrupt();
    this.set('paused');
  }

  /** Riprende dopo una pausa, oppure passa oltre la battuta dell'attore. */
  continue(): void {
    if (this.status === 'paused') {
      // Una pausa di regia interrotta non va ripetuta: si riprende dalla frase.
      if (this.steps?.[this.step]?.type === 'pause') this.step++;
      return void this.loop('user');
    }
    if (this.status === 'waiting') return this.move(this.index + 1, true, 'afterActor');
    if (this.status === 'idle') this.start();
  }

  /**
   * Ripete dall'inizio la battuta corrente. Sul turno dell'attore ripete
   * la battuta d'attacco che lo precede e torna ad attendere.
   */
  repeat(): void {
    const prev = this.plan[this.index - 1];
    if (this.status === 'waiting' && prev && !prev.actor) return this.move(this.index - 1, true, 'user');
    this.move(this.index, true, 'user');
  }

  previous(): void {
    this.move(this.index - 1, this.isRunning(), 'user');
  }

  next(): void {
    this.move(this.index + 1, this.isRunning(), 'user');
  }

  /** Salta a una posizione del piano; se `play`, avvia la lettura. */
  goTo(index: number, play: boolean): void {
    this.move(index, play, 'user');
  }

  stop(): void {
    this.interrupt();
    this.set('idle');
  }

  private move(index: number, play: boolean, arrival: Arrival): void {
    this.interrupt();
    if (index >= this.plan.length) {
      this.index = Math.max(0, this.plan.length - 1);
      this.reset();
      return this.set('finished');
    }
    this.index = Math.max(0, index);
    this.reset();
    if (play) void this.loop(arrival);
    else this.set(this.status === 'idle' ? 'idle' : 'paused');
  }

  private reset(): void {
    this.steps = null;
    this.step = 0;
    this.part = null;
  }

  private isRunning(): boolean {
    return this.status === 'speaking' || this.status === 'waiting';
  }

  private interrupt(): void {
    this.run++;
    this.deps.speaker.cancel();
    this.deps.timer.cancel();
  }

  private set(status: Status): void {
    this.status = status;
    this.deps.onChange(this.state);
  }

  private async loop(arrival: Arrival): Promise<void> {
    const run = ++this.run;
    while (this.index < this.plan.length) {
      const item = this.plan[this.index]!;
      if (item.actor) {
        this.reset();
        return this.set('waiting');
      }
      this.steps ??= this.deps.stepsOf(this.index, arrival);
      this.set('speaking');
      while (this.step < this.steps.length) {
        const s = this.steps[this.step]!;
        let result: 'end' | 'cancelled';
        if (s.type === 'pause') {
          result = await this.deps.timer.wait(s.ms);
        } else {
          this.part = s.part;
          this.deps.onChange(this.state);
          result = await this.deps.speaker.speak(s.text, this.deps.voiceOf(this.index, s));
        }
        if (run !== this.run) return;
        // Annullamento non richiesto (errore della sintesi): ci si ferma senza perdere il punto.
        if (result === 'cancelled') return this.set('paused');
        this.step++;
      }
      if (this.index + 1 >= this.plan.length) break;
      this.index++;
      this.reset();
      arrival = 'auto';
    }
    this.reset();
    this.set('finished');
  }
}
