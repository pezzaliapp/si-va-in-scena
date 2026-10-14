import { describe, expect, it, vi } from 'vitest';
import {
  assignVoices,
  baseVoiceName,
  findVoice,
  loadVoices,
  resolveVoice,
  usableVoices,
  voiceGender,
  type VoiceInfo,
  type VoiceSource,
} from './voices';

const V: VoiceInfo[] = [
  { uri: 'it-a', name: 'Alice', lang: 'it-IT', local: true },
  { uri: 'it-b', name: 'Luca', lang: 'it-IT', local: true },
  { uri: 'it-net', name: 'Rete italiano', lang: 'it-IT', local: false },
  { uri: 'en-a', name: 'Daniel', lang: 'en-GB', local: true },
];

describe('voci', () => {
  it('in privacy rigorosa esclude le voci remote', () => {
    expect(usableVoices(V, true).map((v) => v.uri)).toEqual(['it-a', 'it-b', 'en-a']);
  });

  it('non usa una voce remota in privacy rigorosa', () => {
    const r = resolveVoice({ voiceURI: 'it-net', rate: 1.2, pitch: 1 }, V, true, 'it');
    expect(r).toEqual({ voiceURI: 'it-a', rate: 1.2, pitch: 1 });
  });

  it('senza voci locali in privacy rigorosa non legge', () => {
    expect(resolveVoice(undefined, [V[2]!], true, 'it')).toBeNull();
    expect(resolveVoice(undefined, [V[2]!], false, 'it')?.voiceURI).toBe('it-net');
  });
});

// Voci locali italiane sintetiche (nomi inventati) e una straniera.
const POOL: VoiceInfo[] = ['Ada', 'Bea', 'Ciro', 'Dino', 'Elio'].map((n) => ({
  uri: n.toLowerCase(),
  name: n,
  lang: 'it-IT',
  local: true,
}));
const run = (
  cs: { id: string; name: string; voice?: 'm' | 'f' }[],
  opts: {
    settings?: Record<string, { voiceURI: string | null; rate: number; pitch: number }>;
    genders?: Record<string, 'm' | 'f'>;
    voices?: VoiceInfo[];
    role?: string | null;
  } = {},
) =>
  assignVoices({
    characters: cs,
    role: opts.role ?? null,
    settings: opts.settings ?? {},
    voices: opts.voices ?? [...POOL, V[3]!],
    lang: 'it-IT',
    genders: opts.genders ?? {},
    counts: new Map(cs.map((c, i) => [c.id, 10 - i])),
  });

describe('assegnazione delle voci', () => {
  const cast = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: `p${i + 1}`, name: n }));

  it('voci diverse per ogni personaggio, non la stessa per tutti', () => {
    const r = run(cast);
    const uris = Object.values(r.byId).map((a) => a.voiceURI);
    expect(new Set(uris).size).toBe(4);
    expect(r.shared).toBe(false);
    expect(Object.values(r.byId).every((a) => a.source === 'auto')).toBe(true);
  });

  it('usa solo le voci nella lingua del copione ed esclude l’attore', () => {
    const r = run(cast, { role: 'p1' });
    expect(r.byId.p1).toBeUndefined();
    expect(r.pool.map((v) => v.uri)).toEqual(['ada', 'bea', 'ciro', 'dino', 'elio']);
  });

  it('se le voci non bastano le riusa con intonazione diversa e lo dichiara', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, name: `N${i}` }));
    const r = run(many);
    expect(r.shared).toBe(true);
    const reused = Object.values(r.byId).filter((a) => a.voiceURI === 'ada');
    expect(reused).toHaveLength(2);
    expect(reused[0]!.pitch).not.toBe(reused[1]!.pitch);
  });

  it('rispetta il genere solo quando è confermato per personaggio e voce', () => {
    const genders = { ciro: 'm', dino: 'm', ada: 'f', bea: 'f' } as const;
    const r = run(
      [
        { id: 'p1', name: 'A', voice: 'm' },
        { id: 'p2', name: 'B', voice: 'f' },
        { id: 'p3', name: 'C', voice: 'm' },
        { id: 'p4', name: 'D' },
      ],
      { genders },
    );
    expect(['ciro', 'dino']).toContain(r.byId.p1!.voiceURI);
    expect(['ada', 'bea']).toContain(r.byId.p2!.voiceURI);
    expect(['ciro', 'dino']).toContain(r.byId.p3!.voiceURI);
    expect(r.byId.p1!.voiceURI).not.toBe(r.byId.p3!.voiceURI);
    // Senza preferenza riceve per prima una voce non classificata.
    expect(r.byId.p4!.voiceURI).toBe('elio');
    expect(Object.values(r.byId).every((a) => !a.unverified)).toBe(true);
  });

  it('senza voci classificate non inventa: propone una voce e la segnala come da confermare', () => {
    const r = run([{ id: 'p1', name: 'A', voice: 'm' }]);
    expect(r.byId.p1!.voiceURI).not.toBeNull();
    expect(r.byId.p1!.unverified).toBe(true);
  });

  it('non propone una voce del genere opposto se ce n’è un’altra', () => {
    const r = run([{ id: 'p1', name: 'A', voice: 'm' }], { genders: { ada: 'f', bea: 'f', ciro: 'f', dino: 'f' } });
    expect(r.byId.p1!.voiceURI).toBe('elio');
    expect(r.byId.p1!.unverified).toBe(true);
  });

  it('non sostituisce mai una scelta manuale', () => {
    const settings = { p1: { voiceURI: 'ada', rate: 1.1, pitch: 0.9 } };
    const r = run(
      [
        { id: 'p1', name: 'A', voice: 'm' },
        { id: 'p2', name: 'B' },
      ],
      { settings, genders: { ciro: 'm' } },
    );
    expect(r.byId.p1).toMatchObject({ voiceURI: 'ada', rate: 1.1, pitch: 0.9, source: 'manual', unverified: true });
    expect(r.byId.p2!.voiceURI).not.toBe('ada');
  });

  it('se la voce scelta manca su questo dispositivo lo segnala e propone un’altra voce', () => {
    const settings = { p1: { voiceURI: 'voce-di-un-altro-dispositivo', rate: 1, pitch: 1 } };
    const r = run([{ id: 'p1', name: 'A' }], { settings });
    expect(r.byId.p1!.source).toBe('missing');
    expect(r.byId.p1!.voiceURI).toBe('ada');
  });
});

// Voci italiane locali come le elenca Chrome su macOS (solo nomi e lingua, nessun audio).
const MAC = ['Alice', 'Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley'].map((n) => ({
  uri: n === 'Alice' ? n : `${n} (italiano (Italia))`,
  name: n === 'Alice' ? n : `${n} (italiano (Italia))`,
  lang: 'it-IT',
  local: true,
}));
const SEVEN = ['WALTER', 'MARIO', 'CARLA', 'BARBARA', 'GIACOMO', 'ALICE', 'NONNO'].map((n, i) => ({
  id: `c${i}`,
  name: n,
}));
const COUNTS = new Map(SEVEN.map((c, i) => [c.id, 20 - i]));
const assign7 = (
  opts: {
    voices?: VoiceInfo[];
    settings?: Record<
      string,
      { voiceURI: string | null; rate: number; pitch: number; voiceName?: string; voiceLang?: string }
    >;
    gendered?: boolean;
    role?: string | null;
  } = {},
) =>
  assignVoices({
    characters: opts.gendered
      ? SEVEN.map((c) => ({ ...c, voice: (['CARLA', 'BARBARA', 'ALICE'].includes(c.name) ? 'f' : 'm') as 'm' | 'f' }))
      : SEVEN,
    role: opts.role ?? null,
    settings: opts.settings ?? {},
    voices: opts.voices ?? MAC,
    lang: 'it-IT',
    genders: {},
    counts: COUNTS,
  });

describe('sette personaggi con le voci italiane di macOS', () => {
  it('voci iniziali tutte diverse, non Alice per tutti', () => {
    const r = assign7();
    const uris = Object.values(r.byId).map((a) => a.voiceURI);
    expect(new Set(uris).size).toBe(7);
    expect(r.shared).toBe(false);
  });

  it('con il genere indicato per i personaggi: voci maschili e femminili note dal nome della voce', () => {
    const r = assign7({ gendered: true });
    const g = (id: string) =>
      voiceGender(
        MAC.find((v) => v.uri === r.byId[id]!.voiceURI)!,
        {},
      )!.gender;
    for (const c of SEVEN) expect(g(c.id)).toBe(['CARLA', 'BARBARA', 'ALICE'].includes(c.name) ? 'f' : 'm');
    expect(new Set(Object.values(r.byId).map((a) => a.voiceURI)).size).toBe(7);
    expect(Object.values(r.byId).every((a) => !a.unverified)).toBe(true);
  });

  it('elenco in ordine diverso: stessa assegnazione (nessuna dipendenza dalla posizione)', () => {
    const a = assign7({ gendered: true });
    const b = assign7({ gendered: true, voices: [...MAC].reverse() });
    expect(b.byId).toEqual(a.byId);
  });

  it('la scelta manuale non viene mai sovrascritta, neppure indicando il genere', () => {
    const settings = { c0: { voiceURI: 'Flo (italiano (Italia))', rate: 1, pitch: 1 } };
    const r = assign7({ gendered: true, settings });
    expect(r.byId.c0).toMatchObject({ voiceURI: 'Flo (italiano (Italia))', source: 'manual', unverified: true });
    expect(Object.entries(r.byId).filter(([, a]) => a.voiceURI === 'Flo (italiano (Italia))')).toHaveLength(1);
  });

  it('voce scelta temporaneamente assente: segnalata, sostituita da una dello stesso genere, non da Alice', () => {
    const settings = {
      c1: {
        voiceURI: 'Reed (italiano (Italia))',
        rate: 1,
        pitch: 1,
        voiceName: 'Reed (italiano (Italia))',
        voiceLang: 'it-IT',
      },
    };
    const r = assign7({ settings, voices: MAC.filter((v) => !v.name.startsWith('Reed')) });
    expect(r.byId.c1!.source).toBe('missing');
    expect(r.byId.c1!.voiceURI).not.toBe('Alice');
    expect(
      voiceGender(
        MAC.find((v) => v.uri === r.byId.c1!.voiceURI)!,
        {},
      )!.gender,
    ).toBe('m');
    // Tornata disponibile, la scelta salvata vale di nuovo.
    expect(assign7({ settings }).byId.c1).toMatchObject({ voiceURI: 'Reed (italiano (Italia))', source: 'manual' });
  });
});

describe('identificazione delle voci', () => {
  it('nome di base uguale tra browser', () => {
    expect(baseVoiceName('Eddy (italiano (Italia))')).toBe('eddy');
    expect(baseVoiceName('Eddy')).toBe('eddy');
    expect(baseVoiceName('Microsoft Elsa - Italian (Italy)')).toBe('elsa');
  });

  it('ritrova la voce per nome se l’identificatore cambia (altro browser), mai per posizione', () => {
    const safari: VoiceInfo[] = [
      { uri: 'com.apple.voice.compact.it-IT.Alice', name: 'Alice', lang: 'it-IT', local: true },
      { uri: 'com.apple.eloquence.it-IT.Eddy', name: 'Eddy', lang: 'it-IT', local: true },
    ];
    const chosen = {
      voiceURI: 'Eddy (italiano (Italia))',
      voiceName: 'Eddy (italiano (Italia))',
      voiceLang: 'it-IT',
      rate: 1,
      pitch: 1,
    };
    expect(findVoice(chosen, safari)?.uri).toBe('com.apple.eloquence.it-IT.Eddy');
    expect(findVoice({ ...chosen, voiceLang: 'en-US' }, safari)).toBeUndefined();
    expect(findVoice({ voiceURI: 'sconosciuta', rate: 1, pitch: 1 }, safari)).toBeUndefined();
  });

  it('il genere indicato dall’attore prevale su quello suggerito dal nome della voce', () => {
    const eddy = MAC[1]!;
    expect(voiceGender(eddy, {})).toEqual({ gender: 'm', source: 'known' });
    expect(voiceGender(eddy, { [eddy.uri]: 'f' })).toEqual({ gender: 'f', source: 'user' });
    expect(voiceGender({ ...eddy, lang: 'en-US' }, {})).toBeNull();
  });
});

/** Sintesi finta che annuncia le voci a più riprese, come Chrome su macOS. */
function fakeSource() {
  let list: SpeechSynthesisVoice[] = [];
  const fns = new Set<() => void>();
  const source: VoiceSource = {
    getVoices: () => list,
    addEventListener: (_t, fn) => fns.add(fn),
    removeEventListener: (_t, fn) => fns.delete(fn),
  };
  const announce = (n: number) => {
    list = Array.from(
      { length: n },
      (_, i) => ({ voiceURI: `v${i}`, name: `v${i}`, lang: 'it-IT', localService: true }) as SpeechSynthesisVoice,
    );
    fns.forEach((f) => f());
  };
  return { source, announce };
}

describe('caricamento delle voci', () => {
  it('attende l’elenco completo quando arriva in più riprese', async () => {
    vi.useFakeTimers();
    const { source, announce } = fakeSource();
    let got: SpeechSynthesisVoice[] | null = null;
    void loadVoices(source, 800, 4000).then((v) => (got = v));
    await vi.advanceTimersByTimeAsync(10);
    announce(19);
    await vi.advanceTimersByTimeAsync(600);
    expect(got).toBeNull();
    announce(199);
    await vi.advanceTimersByTimeAsync(799);
    expect(got).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(got).toHaveLength(199);
    vi.useRealTimers();
  });

  it('senza voci si arrende dopo il tempo massimo', async () => {
    vi.useFakeTimers();
    const { source } = fakeSource();
    let got: SpeechSynthesisVoice[] | null = null;
    void loadVoices(source, 800, 4000).then((v) => (got = v));
    await vi.advanceTimersByTimeAsync(4001);
    expect(got).toEqual([]);
    vi.useRealTimers();
  });
});
