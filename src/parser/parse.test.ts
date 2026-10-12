// Tutti i dialoghi di questo file sono originali, scritti per i test del progetto.
import { describe, expect, it } from 'vitest';
import { EVERYONE } from '../types';
import { cleanLines, linesFromText, type RawLine } from './lines';
import { headingLevel, matchCue, parseScript } from './parse';

const parse = (text: string) => parseScript(linesFromText(text), { fileName: 'prova.pdf', now: 1 });
const speeches = (text: string) => parse(text).blocks.filter((b) => b.kind === 'speech');

const COLON_SCRIPT = `
LA LANTERNA SPENTA
Commedia in un atto

ATTO PRIMO

SCENA I
Una cucina di campagna. Sera.

BRUNO: Hai visto la lanterna?
ELSA: L'ho lasciata sul davanzale,
come tutte le sere.
BRUNO (sottovoce): Allora qualcuno l'ha spenta.
(Elsa si avvicina alla finestra)
ELSA: Non c'è nessuno, là fuori.
OTTAVIO (fuori scena): C'è chi c'è!
BRUNO: Chi va là?

SCENA II

OTTAVIO: Buonasera a tutti.
BRUNO E ELSA: Buonasera.
TUTTI: Che notte!
`;

describe('riconoscimento personaggi', () => {
  it('trova i personaggi senza nomi predefiniti', () => {
    const s = parse(COLON_SCRIPT);
    expect(s.characters.map((c) => c.name)).toEqual(['BRUNO', 'ELSA', 'OTTAVIO']);
  });

  it('non scambia le intestazioni per personaggi', () => {
    const s = parse(COLON_SCRIPT);
    expect(s.characters.find((c) => /ATTO|SCENA/.test(c.name))).toBeUndefined();
  });

  it('riconosce il formato "NOME." e "NOME -"', () => {
    const s = speeches(`
GIULIA. Sei in ritardo.
TEO - Lo so, lo so.
GIULIA. Come sempre.
TEO - Come sempre.
GIULIA. Appunto.
`);
    expect(s.map((b) => b.text)).toEqual([
      'Sei in ritardo.', 'Lo so, lo so.', 'Come sempre.', 'Come sempre.', 'Appunto.',
    ]);
  });

  it('riconosce il nome su una riga da solo (impaginazione a colonna)', () => {
    const s = parse(`
MARTA
Chiudi la porta.

PIETRO
Subito.

MARTA
Grazie.

PIETRO
Prego.
`);
    const sp = s.blocks.filter((b) => b.kind === 'speech');
    expect(s.characters.map((c) => c.name)).toEqual(['MARTA', 'PIETRO']);
    expect(sp.map((b) => b.text)).toEqual(['Chiudi la porta.', 'Subito.', 'Grazie.', 'Prego.']);
  });

  it('riconosce nomi composti e con apostrofo', () => {
    const s = parse(`
LA SIGNORA D'AMICO: Il tè è pronto.
IL DOTTORE: Arrivo.
LA SIGNORA D'AMICO: Si fredda.
IL DOTTORE: Arrivo, ho detto.
`);
    expect(s.characters.map((c) => c.name)).toEqual(["LA SIGNORA D'AMICO", 'IL DOTTORE']);
  });

  it('non accetta interiezioni maiuscole come personaggi', () => {
    const s = parse(`
ANNA: No.
NO. Non ci credo.
ANNA: Ripeto.
NO. Davvero no.
`);
    expect(s.characters.map((c) => c.name)).toEqual(['ANNA']);
  });

  it('crea ma segnala un personaggio con una sola battuta', () => {
    const s = parse(`
ANNA: Chi bussa?
LUCA: Io.
ANNA: Entra.
LUCA: Grazie.
POSTINO: Una lettera per lei.
`);
    expect(s.characters.map((c) => c.name)).toEqual(['ANNA', 'LUCA', 'POSTINO']);
    const flagged = s.blocks.find((b) => b.text === 'Una lettera per lei.');
    expect(flagged?.ambiguous).toMatch(/POSTINO/);
  });

  it('segnala un nome isolato non ricorrente senza inventare un personaggio', () => {
    const s = parse(`
ANNA. Chi bussa?
LUCA. Io.
ANNA. Entra.
LUCA. Grazie.
ANNA. Prego.
LUCA. Ecco.
POSTINO. Una lettera per lei.
`);
    expect(s.characters.map((c) => c.name)).toEqual(['ANNA', 'LUCA']);
    expect(s.blocks.find((b) => b.ambiguous?.includes('POSTINO'))).toBeDefined();
  });

  it('riconosce i nomi in maiuscolo/minuscolo con i due punti se ricorrenti', () => {
    const s = parse(`
Carla: Uno.
Dino: Due.
Carla: Tre.
Dino: Quattro.
Carla: Cinque.
Dino: Sei.
`);
    expect(s.characters.map((c) => c.name)).toEqual(['Carla', 'Dino']);
  });
});

describe('ordinamento e battute', () => {
  it('mantiene l’ordine del copione e unisce le battute su più righe', () => {
    const s = speeches(COLON_SCRIPT);
    expect(s.map((b) => b.text)).toEqual([
      'Hai visto la lanterna?',
      "L'ho lasciata sul davanzale, come tutte le sere.",
      "Allora qualcuno l'ha spenta.",
      "Non c'è nessuno, là fuori.",
      "C'è chi c'è!",
      'Chi va là?',
      'Buonasera a tutti.',
      'Buonasera.',
      'Che notte!',
    ]);
  });

  it('ricompone le parole spezzate dal trattino a fine riga', () => {
    const s = speeches(`
ELIO: Questa è una frase lun-
ghissima davvero.
ELIO: Fine.
`);
    expect(s[0]!.text).toBe('Questa è una frase lunghissima davvero.');
  });

  it('una battuta può proseguire alla pagina successiva', () => {
    const lines = [
      ...linesFromText('RITA: Comincio qui', 1),
      ...linesFromText('e finisco qui.', 2),
      ...linesFromText('RITA: Altro.', 2),
    ];
    const s = parseScript(lines, { fileName: 'x.pdf' });
    expect(s.blocks[0]!.text).toBe('Comincio qui e finisco qui.');
  });
});

describe('didascalie', () => {
  it('separa le didascalie tra parentesi dalle battute', () => {
    const s = parse(COLON_SCRIPT);
    const d = s.blocks.find((b) => b.text.startsWith('(Elsa'));
    expect(d?.kind).toBe('direction');
  });

  it('conserva la nota accanto al nome', () => {
    const s = speeches(COLON_SCRIPT);
    expect(s[2]!.note).toBe('sottovoce');
  });

  it('mantiene le didascalie interne alla battuta', () => {
    const s = speeches(`
LEO: Aspetta
(ride) no, scherzavo.
LEO: Davvero.
`);
    expect(s[0]!.text).toBe('Aspetta (ride) no, scherzavo.');
  });

  it('gestisce didascalie su più righe', () => {
    const s = parse(`
LEO: Ciao.
(Entra MIA, stanca, con una valigia
che appoggia a terra.)
MIA: Eccomi.
LEO: Finalmente.
`);
    const d = s.blocks.filter((b) => b.kind === 'direction');
    expect(d).toHaveLength(1);
    expect(d[0]!.text).toBe('(Entra MIA, stanca, con una valigia che appoggia a terra.)');
    expect(s.blocks.at(-2)!.speakers).toEqual([s.characters.find((c) => c.name === 'MIA')!.id]);
  });

  it('segnala il testo senza nome dopo una didascalia', () => {
    const s = parse(`
LEO: Vieni qui.
(MIA non si muove)
Ho detto vieni.
MIA: No.
LEO: Va bene.
`);
    const resumed = s.blocks.find((b) => b.text === 'Ho detto vieni.');
    expect(resumed?.kind).toBe('speech');
    expect(resumed?.speakers).toEqual([s.characters[0]!.id]);
    expect(resumed?.ambiguous).toMatch(/LEO/);
  });

  it('segnala un paragrafo senza nome dopo una battuta', () => {
    const s = parse(`
LEO: Vieni qui.

Mia attraversa la stanza lentamente.

MIA: Eccomi.
LEO: Bene.
`);
    const p = s.blocks.find((b) => b.text.startsWith('Mia attraversa'));
    expect(p?.kind).toBe('direction');
    expect(p?.ambiguous).toBeTruthy();
  });

  it('riconosce l’elenco dei personaggi come blocco a sé', () => {
    const s = parse(`
PERSONAGGI
NORA - una pittrice
IVO - suo fratello

ATTO I
NORA: Sei tornato.
IVO: Sono tornato.
`);
    expect(s.blocks[0]!.kind).toBe('cast');
    expect(s.blocks.filter((b) => b.kind === 'speech')).toHaveLength(2);
  });
});

describe('dialoghi simultanei e fuori scena', () => {
  it('attribuisce le battute a più personaggi insieme', () => {
    const s = parse(COLON_SCRIPT);
    const both = s.blocks.find((b) => b.text === 'Buonasera.')!;
    const ids = ['BRUNO', 'ELSA'].map((n) => s.characters.find((c) => c.name === n)!.id);
    expect(both.speakers).toEqual(ids);
    expect(both.simultaneous).toBe(true);
  });

  it('riconosce TUTTI come battuta corale', () => {
    const s = parse(COLON_SCRIPT);
    const all = s.blocks.find((b) => b.text === 'Che notte!')!;
    expect(all.speakers).toEqual([EVERYONE]);
    expect(all.simultaneous).toBe(true);
  });

  it('riconosce l’indicazione "insieme" accanto al nome', () => {
    const s = speeches(`
ADA: Uno.
EVA: Due.
ADA (insieme): Tre!
EVA (insieme): Tre!
`);
    expect(s[2]!.simultaneous).toBe(true);
    expect(s[3]!.simultaneous).toBe(true);
  });

  it('riconosce le voci fuori scena', () => {
    const s = speeches(COLON_SCRIPT);
    expect(s.find((b) => b.text === "C'è chi c'è!")?.offstage).toBe(true);
    expect(s.find((b) => b.text === 'Chi va là?')?.offstage).toBeUndefined();
  });
});

describe('atti e scene', () => {
  it('riconosce le intestazioni con il loro livello', () => {
    expect(headingLevel('ATTO PRIMO')).toBe(1);
    expect(headingLevel('Atto II')).toBe(1);
    expect(headingLevel('SCENA 3')).toBe(2);
    expect(headingLevel('Scena seconda')).toBe(2);
    expect(headingLevel('PRIMO TEMPO')).toBe(1);
    expect(headingLevel('PROLOGO')).toBe(1);
    expect(headingLevel('Atto di coraggio, il tuo.')).toBeNull();
  });

  it('crea i blocchi intestazione nell’ordine corretto', () => {
    const s = parse(COLON_SCRIPT);
    expect(s.blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual([
      'ATTO PRIMO',
      'SCENA I',
      'SCENA II',
    ]);
  });

  it('usa il titolo indicato o il nome del file', () => {
    expect(parseScript([], { fileName: 'Il mio copione.pdf' }).title).toBe('Il mio copione');
    expect(parseScript([], { fileName: 'a.pdf', title: 'Titolo' }).title).toBe('Titolo');
  });

  it('avvisa quando non trova personaggi', () => {
    const s = parse('Solo un testo in prosa senza dialoghi.');
    expect(s.characters).toHaveLength(0);
    expect(s.warnings[0]).toMatch(/Nessun personaggio/);
  });
});

describe('matchCue', () => {
  it('accetta nomi con punto quando c’è il due punti', () => {
    expect(matchCue('SIG. ROSSI: Buongiorno.')?.key).toBe('SIG ROSSI');
  });
  it('non considera una frase maiuscola seguita da minuscola', () => {
    expect(matchCue('ROMA. città eterna')).toBeNull();
  });
});

describe('pulizia impaginazione', () => {
  const page = (p: number, rows: [number, string][]): RawLine[] =>
    rows.map(([y, text]) => ({ text, page: p, y, pageHeight: 800 }));

  it('rimuove numeri di pagina e intestazioni ripetute', () => {
    const raw: RawLine[] = [];
    for (let p = 1; p <= 4; p++) {
      raw.push(
        ...page(p, [
          [30, 'La lanterna spenta — copione di prova'],
          [100, `RIGA: testo numero ${'abcd'[p - 1]}.`],
          [114, 'seguito.'],
          [770, `- ${p} -`],
        ]),
      );
    }
    const lines = cleanLines(raw);
    expect(lines.map((l) => l.text)).toEqual([
      'RIGA: testo numero a.', 'seguito.', 'RIGA: testo numero b.', 'seguito.',
      'RIGA: testo numero c.', 'seguito.', 'RIGA: testo numero d.', 'seguito.',
    ]);
  });

  it('individua i paragrafi dallo spazio verticale', () => {
    const lines = cleanLines(
      page(1, [
        [100, 'a'],
        [114, 'b'],
        [128, 'c'],
        [160, 'd'],
        [174, 'e'],
      ]),
    );
    expect(lines.map((l) => l.paragraphBreak)).toEqual([false, false, false, true, false]);
  });
});

describe('formati senza punteggiatura tra nome e battuta', () => {
  it('nome in colonna separato da tabulazione, con battuta su più righe', () => {
    const s = parse(`
ATTO I
ZENO\tHo trovato la chiave
sotto il vaso dei gerani.
LIA\tQuale vaso?
ZENO\tQuello rotto.
LIA\tAh.
`);
    expect(s.characters.map((c) => c.name)).toEqual(['ZENO', 'LIA']);
    expect(s.blocks.filter((b) => b.kind === 'speech').map((b) => b.text)).toEqual([
      'Ho trovato la chiave sotto il vaso dei gerani.',
      'Quale vaso?',
      'Quello rotto.',
      'Ah.',
    ]);
  });

  it('nome in maiuscolo seguito direttamente dalla battuta', () => {
    const s = parse(`
ZENO Ho trovato la chiave.
LIA Quale chiave?
ZENO Quella del garage.
LIA Non abbiamo un garage.
ZENO Appunto.
LIA (ridendo) Allora è di qualcun altro.
`);
    expect(s.characters.map((c) => c.name)).toEqual(['ZENO', 'LIA']);
    const sp = s.blocks.filter((b) => b.kind === 'speech');
    expect(sp).toHaveLength(6);
    expect(sp[5]!.note).toBe('ridendo');
    expect(sp[5]!.text).toBe('Allora è di qualcun altro.');
  });

  it('nome in grassetto seguito dalla battuta', () => {
    const line = (name: string, text: string) => ({
      text: `${name} ${text}`,
      page: 1,
      paragraphBreak: false,
      runs: [{ text: name, bold: true }, { text: ` ${text}` }],
    });
    const s = parseScript([line('Zeno', 'Ciao.'), line('Lia', 'Ciao a te.'), line('Zeno', 'Come va?'), line('Lia', 'Bene.')], {
      fileName: 'x.pdf',
    });
    expect(s.characters.map((c) => c.name)).toEqual(['Zeno', 'Lia']);
    expect(s.blocks.map((b) => b.text)).toEqual(['Ciao.', 'Ciao a te.', 'Come va?', 'Bene.']);
  });

  it('le righe in corsivo senza parentesi sono didascalie', () => {
    const lines = linesFromText('ZENO\tCiao.\nLIA\tCiao.\nZenone entra in cucina.\nZENO\tEccomi.\nLIA\tBene.');
    lines[2]!.italic = true;
    const s = parseScript(lines, { fileName: 'x.pdf' });
    const d = s.blocks.find((b) => b.text === 'Zenone entra in cucina.');
    expect(d?.kind).toBe('direction');
    expect(d?.ambiguous).toBeUndefined();
  });

  it('se il documento usa un formato forte, non inventa personaggi da parole maiuscole', () => {
    const s = parse(
      Array.from({ length: 6 }, () => 'ZENO: Una battuta.\nLIA: Una risposta.\nZENO: E allora?\nRAI Uno trasmette la partita.')
        .join('\n'),
    );
    expect(s.characters.map((c) => c.name)).toEqual(['ZENO', 'LIA']);
  });
});

describe('frontespizio e titolo', () => {
  it('distingue titolo e crediti senza segnalarli come personaggi', () => {
    const s = parseScript(
      linesFromText(`
DUE STANZE E UN GATTO
Commedia di Autrice Immaginaria
Tutti i diritti riservati

ATTO I
ZENO: Ciao.
LIA: Ciao.
ZENO: Ancora tu?
LIA: Sempre io.
`),
      { fileName: 'x.pdf', title: 'DUE STANZE E UN GATTO' },
    );
    expect(s.blocks[0]!.kind).toBe('front');
    expect(s.blocks.filter((b) => b.ambiguous)).toEqual([]);
    expect(s.characters.map((c) => c.name)).toEqual(['ZENO', 'LIA']);
  });

  it('il titolo ripetuto non diventa un personaggio', () => {
    const body = Array.from({ length: 4 }, () => 'IL GATTO NERO\nZENO\tCiao.\nLIA\tCiao.').join('\n');
    const s = parseScript(linesFromText(body), { fileName: 'x.pdf', title: 'IL GATTO NERO' });
    expect(s.characters.map((c) => c.name)).toEqual(['ZENO', 'LIA']);
  });
});

describe('intestazioni ripetute', () => {
  it('non scambia per intestazione un nome che ricorre su tutte le pagine in posizioni diverse', () => {
    const raw: RawLine[] = [];
    for (let p = 1; p <= 10; p++) {
      for (let k = 0; k < 8; k++) {
        raw.push({ text: k % 2 ? 'Una battuta diversa ' + p + k : 'MIRA', page: p, y: 100 + k * 14 + ((p * 37) % 300), pageHeight: 800 });
      }
    }
    const kept = cleanLines(raw);
    expect(kept.filter((l) => l.text === 'MIRA')).toHaveLength(40);
  });

  it('rimuove un’intestazione nella stessa posizione su ogni pagina', () => {
    const raw: RawLine[] = [];
    for (let p = 1; p <= 10; p++) {
      raw.push({ text: 'IL GATTO NERO', page: p, y: 40, pageHeight: 800 });
      raw.push({ text: `Testo ${p}.`, page: p, y: 120, pageHeight: 800 });
    }
    expect(cleanLines(raw).map((l) => l.text)).not.toContain('IL GATTO NERO');
  });
});
