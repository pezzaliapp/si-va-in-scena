import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSpeechSpeaker } from './speaker';

const OPTS = { voiceURI: null, rate: 1, pitch: 1 };

class FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

/**
 * Sintesi vocale simulata con il difetto osservato in Chrome su macOS:
 * annullare un enunciato in coda ma non ancora iniziato blocca la sintesi,
 * e da quel momento nessun enunciato parte più.
 */
class FakeSynth {
  queue: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  started: string[] = [];
  wedged = false;

  get speaking() {
    return this.current !== null || this.queue.length > 0;
  }
  get pending() {
    return this.queue.length > 0;
  }
  speak(u: FakeUtterance) {
    this.queue.push(u);
    if (!this.current) setTimeout(() => this.next(), 5);
  }
  cancel() {
    if (this.queue.length > 0 && !this.current) this.wedged = true;
    const all = [...(this.current ? [this.current] : []), ...this.queue];
    this.current = null;
    this.queue = [];
    for (const u of all) u.onerror?.({ error: 'interrupted' });
  }
  resume() {}
  getVoices() {
    return [];
  }
  private next() {
    if (this.wedged || this.current) return;
    const u = this.queue.shift();
    if (!u) return;
    this.current = u;
    this.started.push(u.text);
    u.onstart?.();
    setTimeout(() => {
      if (this.current !== u) return;
      this.current = null;
      u.onend?.();
      this.next();
    }, u.text.trim() ? 200 : 1);
  }
}

let synth: FakeSynth;

beforeEach(() => {
  vi.useFakeTimers();
  synth = new FakeSynth();
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WebSpeechSpeaker', () => {
  it('modello: annullare un enunciato non iniziato blocca la sintesi', async () => {
    synth.speak(new FakeUtterance(' '));
    synth.cancel();
    synth.speak(new FakeUtterance('Battuta'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(synth.wedged).toBe(true);
    expect(synth.started).toEqual([]);
  });

  it("dopo lo sblocco la prima battuta viene pronunciata (Avvia: sblocco, annullamento, battuta)", async () => {
    const speaker = new WebSpeechSpeaker(() => []);
    speaker.prime();
    speaker.cancel(); // come RehearsalEngine.start()
    const result = speaker.speak('Hai acceso la luce?', OPTS);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe('end');
    expect(synth.wedged).toBe(false);
    expect(synth.started).toEqual([' ', 'Hai acceso la luce?']);
  });

  it('una battuta annullata durante lo sblocco non parte e non blocca la sintesi', async () => {
    const speaker = new WebSpeechSpeaker(() => []);
    speaker.prime();
    const first = speaker.speak('Prima', OPTS);
    speaker.cancel();
    const second = speaker.speak('Seconda', OPTS);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first).toBe('cancelled');
    expect(await second).toBe('end');
    expect(synth.wedged).toBe(false);
    expect(synth.started).toEqual([' ', 'Seconda']);
  });

  it("se lo sblocco non termina, la battuta parte comunque dopo l'attesa massima", async () => {
    const speaker = new WebSpeechSpeaker(() => []);
    synth.speak = (u) => void synth.queue.push(u); // lo sblocco resta in coda senza eventi
    speaker.prime();
    synth.speak = FakeSynth.prototype.speak.bind(synth);
    synth.queue = [];
    const result = speaker.speak('Battuta', OPTS);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe('end');
    expect(synth.started).toEqual(['Battuta']);
  });
});
