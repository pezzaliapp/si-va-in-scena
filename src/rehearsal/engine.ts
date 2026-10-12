import { chunkText, speakableText } from '../speech/text';
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

export type Status = 'idle' | 'speaking' | 'paused' | 'waiting' | 'finished';

export interface EngineState {
  status: Status;
  /** Posizione nel piano di prova. */
  index: number;
}

export interface EngineDeps {
  speaker: Speaker;
  textOf(item: PlanItem): string;
  voiceOf(item: PlanItem): SpeakOptions;
  onChange(state: EngineState): void;
}

/**
 * Motore della prova: legge le battute degli altri personaggi e si ferma
 * sul turno dell'attore finché non riceve il comando "Continua".
 */
export class RehearsalEngine {
  private status: Status = 'idle';
  private index: number;
  private chunk = 0;
  private run = 0;

  constructor(
    private readonly plan: PlanItem[],
    private readonly deps: EngineDeps,
    startIndex = 0,
  ) {
    this.index = Math.min(Math.max(0, startIndex), Math.max(0, plan.length - 1));
  }

  get state(): EngineState {
    return { status: this.status, index: this.index };
  }

  /** Avvia (o riavvia) la lettura dalla posizione corrente. */
  start(): void {
    if (this.plan.length === 0) return this.set('finished');
    this.interrupt();
    if (this.status === 'finished') this.index = 0;
    this.chunk = 0;
    void this.loop();
  }

  pause(): void {
    if (this.status !== 'speaking') return;
    this.interrupt();
    this.set('paused');
  }

  /** Riprende dopo una pausa, oppure passa oltre la battuta dell'attore. */
  continue(): void {
    if (this.status === 'paused') return void this.loop();
    if (this.status === 'waiting') return this.goTo(this.index + 1, true);
    if (this.status === 'idle') this.start();
  }

  /** Ripete la battuta corrente dall'inizio. */
  repeat(): void {
    this.goTo(this.index, true);
  }

  previous(): void {
    this.goTo(this.index - 1, this.isRunning());
  }

  next(): void {
    this.goTo(this.index + 1, this.isRunning());
  }

  /** Salta a una posizione del piano. */
  goTo(index: number, play: boolean): void {
    this.interrupt();
    if (index >= this.plan.length) {
      this.index = Math.max(0, this.plan.length - 1);
      return this.set('finished');
    }
    this.index = Math.max(0, index);
    this.chunk = 0;
    if (play) void this.loop();
    else this.set(this.status === 'idle' ? 'idle' : 'paused');
  }

  stop(): void {
    this.interrupt();
    this.set('idle');
  }

  private isRunning(): boolean {
    return this.status === 'speaking' || this.status === 'waiting';
  }

  private interrupt(): void {
    this.run++;
    if (this.status === 'speaking') this.deps.speaker.cancel();
  }

  private set(status: Status): void {
    this.status = status;
    this.deps.onChange(this.state);
  }

  private async loop(): Promise<void> {
    const run = ++this.run;
    while (this.index < this.plan.length) {
      const item = this.plan[this.index]!;
      if (item.actor) {
        this.chunk = 0;
        return this.set('waiting');
      }
      const chunks = chunkText(speakableText(this.deps.textOf(item)));
      this.set('speaking');
      while (this.chunk < chunks.length) {
        const result = await this.deps.speaker.speak(chunks[this.chunk]!, this.deps.voiceOf(item));
        if (run !== this.run) return;
        if (result === 'cancelled') return this.set('paused');
        this.chunk++;
      }
      this.chunk = 0;
      if (this.index + 1 >= this.plan.length) break;
      this.index++;
    }
    this.set('finished');
  }
}
