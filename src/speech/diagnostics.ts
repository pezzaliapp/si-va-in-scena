// Registro locale degli eventi della sintesi vocale e dell'importazione, per la
// sezione Diagnostica. Resta in memoria, non viene inviato a nessuno e non
// contiene mai il testo delle battute: solo tipo di evento, voce, lunghezza.
import type { VoiceInfo } from './voices';

export type SpeechEventKind =
  | 'sblocco'
  | 'sblocco-fine'
  | 'sblocco-timeout'
  | 'richiesta'
  | 'avvio'
  | 'fine'
  | 'fine-presunta'
  | 'annullata'
  | 'errore'
  | 'timeout-avvio';

export interface SpeechEvent {
  /** Millisecondi dall'apertura dell'app. */
  at: number;
  kind: SpeechEventKind;
  voice?: string;
  local?: boolean;
  /** Lunghezza del testo, mai il testo. */
  chars?: number;
  code?: string;
  /** Stato del sintetizzatore al momento dell'evento. */
  synth: string;
}

export interface ImportFailure {
  stage: 'lettura PDF' | 'salvataggio';
  detail: string;
}

const MAX_EVENTS = 20;
const started = Date.now();
let events: SpeechEvent[] = [];
let importFailure: ImportFailure | null = null;
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

export function synthState(): string {
  if (typeof window === 'undefined' || !window.speechSynthesis) return 'non disponibile';
  const s = window.speechSynthesis;
  return `speaking=${s.speaking} pending=${s.pending} paused=${s.paused}`;
}

export function logSpeech(e: Omit<SpeechEvent, 'at' | 'synth'>): void {
  events = [...events, { ...e, at: Date.now() - started, synth: synthState() }].slice(-MAX_EVENTS);
  notify();
}

export function logImportFailure(f: ImportFailure): void {
  importFailure = f;
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cambia a ogni nuovo evento (per useSyncExternalStore). */
export function snapshot(): number {
  return version;
}

export function speechEvents(): SpeechEvent[] {
  return events;
}

export function lastImportFailure(): ImportFailure | null {
  return importFailure;
}

/** Browser e sistema in forma breve (es. "Chrome 141 · macOS"), senza altri dati. */
export function browserLabel(ua: string): string {
  const browser =
    /Edg\/(\d+)/.exec(ua)?.[1] !== undefined
      ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
      : /Firefox\/(\d+)/.test(ua)
        ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
        : /(?:Chrome|CriOS)\/(\d+)/.test(ua)
          ? `Chrome ${/(?:Chrome|CriOS)\/(\d+)/.exec(ua)![1]}`
          : /Version\/([\d.]+).*Safari/.test(ua)
            ? `Safari ${/Version\/([\d.]+)/.exec(ua)![1]}`
            : 'browser sconosciuto';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS/iPadOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'sistema sconosciuto';
  return `${browser} · ${os}`;
}

export interface ReportInput {
  appVersion: string;
  browser: string;
  serviceWorker: string;
  strictPrivacy: boolean;
  lang: string;
  voices: VoiceInfo[];
  events: SpeechEvent[];
  importFailure: ImportFailure | null;
  synth: string;
}

/** Testo del rapporto da copiare in una segnalazione. */
export function buildReport(r: ReportInput): string {
  const prefix = r.lang.slice(0, 2).toLowerCase();
  const local = r.voices.filter((v) => v.local);
  const localLang = local.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  const fmt = (e: SpeechEvent) =>
    [
      `${(e.at / 1000).toFixed(2)}s`,
      e.kind,
      e.voice ? `voce=${e.voice}${e.local === undefined ? '' : e.local ? ' (locale)' : ' (RETE)'}` : '',
      e.chars !== undefined ? `caratteri=${e.chars}` : '',
      e.code ? `codice=${e.code}` : '',
      `[${e.synth}]`,
    ]
      .filter(Boolean)
      .join(' ');
  return [
    'SI VA IN SCENA — diagnostica',
    `Versione: ${r.appVersion}`,
    `Browser: ${r.browser}`,
    `Service worker: ${r.serviceWorker}`,
    `Privacy rigorosa: ${r.strictPrivacy ? 'attiva' : 'disattivata'}`,
    `Voci: ${r.voices.length} totali, ${local.length} locali, ${localLang.length} locali in ${prefix}`,
    `Voci locali in ${prefix}: ${localLang.map((v) => v.name).join(', ') || 'nessuna'}`,
    `Sintetizzatore ora: ${r.synth}`,
    `Ultimo errore di importazione: ${r.importFailure ? `${r.importFailure.stage} — ${r.importFailure.detail}` : 'nessuno'}`,
    `Ultimi eventi vocali (${r.events.length}):`,
    ...(r.events.length ? r.events.map((e) => `  ${fmt(e)}`) : ['  nessuno']),
  ].join('\n');
}
