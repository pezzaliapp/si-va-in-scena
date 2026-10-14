# SI VA IN SCENA

**Il tuo copione. La tua parte. Si va in scena.**

Progressive Web App per lo studio e le prove di copioni teatrali. L'attore importa il proprio
copione PDF, sceglie il personaggio che interpreta e ascolta le battute degli altri personaggi
lette da voci sintetiche; quando arriva il suo turno la lettura si ferma e attende.

Autore: **Alessandro Pezzali** · Licenza: [MIT](LICENSE)

> **Versione beta.** Il riconoscimento dei copioni PDF va sempre controllato nella scheda
> *Verifica*, dove personaggi e battute si correggono a mano. Le voci sono quelle del sistema:
> pause e ritmo sono regolabili, l'espressività dipende dalla voce installata.
> Segnalazioni e suggerimenti: [GitHub Issues](https://github.com/pezzaliapp/si-va-in-scena/issues/new?template=feedback.yml)
> — **non allegare PDF e non incollare testo dei copioni**, descrivi il problema con parole tue.

---

## Principi

- **Tutto sul dispositivo.** Lettura del PDF, estrazione del testo, analisi, correzioni,
  salvataggio e prove avvengono nel browser. Nessun backend, nessun account, nessun cloud.
- **Costo zero.** Nessuna API a pagamento, nessun servizio a consumo, nessuna telemetria,
  pubblicità o tracciamento.
- **Copioni protetti.** Nessun copione è incluso nel repository o nell'app. Ogni attore importa
  i propri PDF, che non lasciano mai il dispositivo. Il file PDF originale non viene nemmeno
  conservato: si salva solo il testo elaborato, in IndexedDB.
- **Content Security Policy** in produzione: la pagina può contattare solo la propria origine,
  quindi il testo dei copioni non può essere inviato altrove dal codice dell'app.

## Come si usa

1. **Importa** un PDF dal dispositivo.
2. **Verifica**: controlla personaggi e battute. Le parti incerte sono segnalate (⚠): puoi
   rinominare o unire personaggi, riattribuire, dividere, unire o eliminare passaggi, trasformare
   una battuta in didascalia e viceversa. I nomi con poche battute molto simili a un altro
   personaggio (es. una L letta come I) sono proposti per l'unione: nulla viene unito senza
   conferma.
3. **Ruolo**: rispondi a *“Quale personaggio interpreti?”*. Puoi cambiarlo quando vuoi.
4. **Voci**: ogni personaggio riceve una voce diversa; indica se preferisci una voce maschile o
   femminile e l'app ne terrà conto. Puoi scegliere voce, velocità e intonazione e ascoltare
   l'anteprima: le scelte restano salvate sul dispositivo.
5. **Prova**: Avvia, Pausa, Continua, Ripeti, Precedente, Successiva.
   Da tastiera: Spazio, frecce, R.

Modalità disponibili: **Prova** (si ferma sulle tue battute), **Memoria** (le tue battute sono
nascoste finché non le mostri), **Lettura completa**, prova di **una singola scena o atto**,
**Studio** (elenco delle tue battute con l'attacco che le precede).

Per ogni copione vengono ricordati ruolo, voci, modalità, scena e punto di lettura.

### Backup ed eliminazione

Dalla schermata principale puoi esportare un backup (file JSON), ripristinarlo su un altro
dispositivo, eliminare un singolo copione con tutti i suoi dati o cancellare tutto.
Il backup contiene il testo dei copioni: conservalo con cura.

## Sintesi vocale: cosa aspettarsi

L'app usa la Web Speech API del browser, cioè le voci già presenti nel sistema operativo.
È gratuita, ma ha limiti reali che non dipendono dall'app:

- **Numero di voci.** Dipende dal dispositivo. Se le voci sono meno dei personaggi, alcune
  vengono condivise e distinte solo dall'intonazione: l'app lo dichiara.
- **Voci locali e voci di rete.** Alcuni browser offrono voci “di rete” (ad esempio le voci
  Google in Chrome desktop, o le voci “Online (Natural)” in Edge) che inviano il testo a un
  server del fornitore per sintetizzarlo. In **privacy rigorosa** (attiva per impostazione
  predefinita) l'app usa solo voci che il browser dichiara locali (`localService`). Questa
  indicazione è fornita dal browser e l'app non può verificarla in modo indipendente.
- **Genere delle voci.** Il browser non dice se una voce è maschile o femminile. Per le voci
  italiane di sistema più comuni (Alice, Eddy, Flo, Grandma, Grandpa, Reed, Rocko, Sandy,
  Shelley, Luca, Federica, Paola, Elsa, Cosimo) l'app propone un'indicazione iniziale ricavata
  dal nome della voce: è un suggerimento non verificato, che puoi correggere dopo l'anteprima;
  per le altre voci puoi indicarlo tu. La tua indicazione prevale sempre.
- **Voci maschili e femminili per i personaggi.** Il genere di un personaggio non viene mai
  dedotto dal suo nome: va indicato nella scheda Voci (maschile/femminile). Finché non lo
  indichi, l'app assegna voci diverse tra loro ma non sceglie voci maschili o femminili.
- **Elenco delle voci.** Alcuni browser lo caricano a più riprese (Chrome su macOS: prima una
  ventina di voci, poi tutte): l'app attende l'elenco completo. Una voce scelta viene ritrovata
  per identificatore o per nome, mai per posizione; se manca sul dispositivo l'app lo segnala.
- **Intonazione** non supportata da tutte le voci.
- **Nessun riconoscimento vocale**: per proseguire dopo la tua battuta si usa “Continua”
  (o la barra spaziatrice). Il riconoscimento vocale dei browser è spesso remoto e non viene usato.

### Regia vocale

Tra il copione e la sintesi c'è un modulo di regia (`src/pacing/`), indipendente dal parser
e dal motore vocale, che decide *come* leggere:

- divide le battute in **frasi** (rispettando abbreviazioni come “sig.” e “dott.”, iniziali,
  numeri decimali, punteggiatura multipla, virgolette) e le pronuncia una alla volta;
- inserisce **pause temporizzate** dopo punto, domanda, esclamazione e puntini di sospensione,
  e non dopo le virgole: dentro la frase l'intonazione resta affidata alla voce;
- applica una **pausa tra personaggi** regolabile; dopo una battuta interrotta (“—”, “…”) chi
  segue attacca subito;
- il **ritmo generale** agisce soprattutto sulle pause, e solo marginalmente sulla velocità;
- nessuna pausa supera 1,5 secondi;
- le **didascalie** restano visibili ma non vengono lette, salvo l'opzione “Leggi anche le
  didascalie”, che usa la voce narrante;
- sul turno dell'attore l'attesa è **illimitata** fino a “Continua”, con una breve pausa
  d'attacco regolabile. “Ripeti” ricomincia la battuta corrente; sul proprio turno fa
  riascoltare la battuta d'attacco.

**Cosa non può fare.** Le voci di sistema non hanno controlli di emozione, enfasi o
intenzione: l'app regola solo pause, velocità e (dove supportata) intonazione. La prosodia
dentro ogni frase dipende interamente dalla voce installata. Ogni frase è un enunciato
separato, quindi alla pausa voluta si somma la latenza di avvio del motore, che varia da
dispositivo a dispositivo: il cursore del ritmo serve anche a compensarla.

### Installare voci locali

- **macOS**: Impostazioni di Sistema → Accessibilità → Contenuti letti → Voce di sistema →
  Gestisci voci. Le voci scaricate funzionano offline in Safari, Chrome ed Edge.
- **iOS / iPadOS**: Impostazioni → Accessibilità → Contenuti letti → Voci.
- **Windows**: Impostazioni → Ora e lingua → Voce → Aggiungi voci.
- **Android**: Impostazioni → Accessibilità / Sistema → Output sintesi vocale; scarica i dati
  vocali della lingua nel motore di sintesi installato.

## Limiti conosciuti

- **PDF supportati**: solo PDF con testo estraibile (esportati da Word, Pages, LibreOffice…).
  Per i PDF scansionati l'app mostra un messaggio; l'OCR locale potrà essere valutato in futuro.
- **Riconoscimento**: vedi la sezione *Formati di copione riconosciuti*.
- **Safari / iOS**:
  - la voce parte solo dopo un tocco dell'utente (per questo la prova inizia da “Avvia”);
  - con lo schermo bloccato o l'app in background la lettura si interrompe;
  - Safari può cancellare i dati dei siti non usati per 7 giorni: **installa l'app nella
    schermata Home** (Condividi → Aggiungi alla schermata Home) per proteggerli, ed esporta
    periodicamente un backup;
  - in rari casi Safari non segnala la fine di una frase: un timer di sicurezza fa proseguire la lettura;
  - le frasi successive alla prima partono da un timer: la sintesi viene “sbloccata” al primo
    tocco su Avvia/Continua; se iOS la blocca comunque, l'app va in pausa e lo segnala.
- **Chrome / Edge**: le voci vengono caricate in modo asincrono; i testi lunghi vengono divisi
  in frasi per evitare interruzioni note del motore di sintesi; dopo un annullamento la frase
  successiva parte con un ritardo minimo (80 ms) per evitare che venga scartata.
- **Firefox**: non supporta l'installazione come PWA su desktop; l'app funziona comunque nel browser.

## Formati di copione riconosciuti

Il parser non usa nomi predefiniti: deduce il formato dal documento, sfruttando testo,
geometria (rientri, colonne, spazi ampi, centratura, dimensione del carattere) e stile
(grassetto, corsivo) ricavati localmente con PDF.js.

Formati delle battute riconosciuti:

| Formato | Esempio |
| --- | --- |
| Nome seguito da due punti | `VERA: Hai acceso la luce?` |
| Nome seguito da trattino o punto | `VERA - Hai acceso…` · `VERA. Hai acceso…` |
| Nome in colonna, separato da tabulazione o cella di tabella | `VERA      Hai acceso la luce?` |
| Nome in grassetto seguito dalla battuta | **VERA** Hai acceso la luce? |
| Nome su una riga da solo (anche centrato), battuta sotto | `VERA` ↵ `Hai acceso la luce?` |
| Nome in maiuscolo seguito direttamente dalla battuta | `VERA Hai acceso la luce?` |
| Nome in maiuscolo/minuscolo con due punti o in colonna | `Vera: Hai acceso…` |

Vengono inoltre distinti:

- il **frontespizio**: titolo (riconosciuto dalla dimensione del carattere), autore, crediti;
- l'**elenco dei personaggi** (dopo “PERSONAGGI”, “INTERPRETI”, ecc.), i cui nomi aiutano il riconoscimento;
- **atti e scene** (`ATTO I`, `SCENA SECONDA`, `PRIMO TEMPO`, `PROLOGO`…);
- **didascalie** tra parentesi (anche su più righe) o interamente in corsivo; dentro una
  didascalia aperta, un nome in maiuscolo non viene scambiato per una nuova battuta;
- **didascalie interne**: quelle brevi (“(ride)”, “(chiama)”) restano nella battuta, visibili
  ma non lette; quelle lunghe (oltre 8 parole) o non chiuse diventano didascalie autonome
  nella stessa posizione, senza perdere testo;
- **battute su più righe e su più pagine**, parole spezzate dal trattino;
- **intestazioni e piè di pagina ripetuti** e numeri di pagina, che vengono rimossi;
- **battute corali** (`TUTTI`, `VERA E GINO`), indicazioni “fuori scena” e “insieme”.

Quando il documento usa in prevalenza un formato inequivocabile (es. due punti o colonne),
i formati più deboli (nome maiuscolo senza separatore) valgono solo per nomi già riconosciuti,
per non trasformare in personaggi parole scritte in maiuscolo.

Non riconosciuti, o riconosciuti solo in parte (segnalati come *da verificare*):

- PDF scansionati, senza testo selezionabile (messaggio esplicito; OCR non disponibile);
- dialoghi impaginati su **due colonne affiancate** (battute simultanee in parallelo);
- didascalie **senza parentesi e non in corsivo** dopo una battuta (segnalate, non attribuite);
- nomi scritti in modi diversi nello stesso copione (es. `VERA` e `V.`): vanno uniti nella Verifica;
- copioni in cui il nome non è distinguibile dal testo per posizione, punteggiatura, maiuscolo o grassetto.

### Diagnostica della voce e dell'importazione

Nella schermata principale e nella scheda **Voci** la sezione *Diagnostica* mostra versione
dell'app, browser, stato del service worker, voci disponibili (totali, locali, locali in
italiano), stato del sintetizzatore, gli ultimi eventi vocali (richiesta, avvio, fine, errore,
timeout: con la sola lunghezza del testo) e l'ultimo errore di importazione. “Prova la voce”
pronuncia una frase fissa; “Copia il rapporto” lo copia per una segnalazione. Il rapporto resta
sul dispositivo e non contiene testo dei copioni, nomi dei personaggi o dati personali.

Una battuta risulta “in lettura” solo quando il browser conferma l'avvio dell'audio. Se la voce
non parte entro 5 secondi la prova si ferma sulla stessa frase con il messaggio “Voce non
avviata” e il pulsante **Riprova**, senza avanzare. In Chrome su macOS il motore vocale può
restare bloccato per l'intero browser: in quel caso serve chiudere completamente Chrome (Cmd+Q)
e riaprirlo.

### Diagnostica locale di un PDF

Se un copione non viene riconosciuto:

- nell'app, la sezione **Verifica** contiene *Dati di lettura del PDF*: pagine, righe estratte,
  battute per formato. Solo numeri, nessun testo;
- da terminale, `npm run diagnose -- copione.pdf 1-3` mostra la struttura delle pagine indicate:
  posizioni, dimensioni, font e la *forma* delle righe, con le lettere mascherate (`AAAA: Aaa…`).
  Il testo del copione non viene mostrato né salvato e nulla esce dal computer.

## Sviluppo

Requisiti: Node.js ≥ 22.

```sh
npm install        # installa le dipendenze e attiva il controllo pre-commit
npm run dev        # server di sviluppo
npm run verify     # TypeScript + lint + test + build
npm run preview    # anteprima della build (PWA e funzionamento offline)
```

Struttura:

```
src/
  parser/      righe dal layout del PDF → personaggi, battute, didascalie, scene (funzioni pure)
  pdf/         lettura locale con PDF.js e ricostruzione delle righe
  script/      correzioni manuali del copione
  pacing/      regia vocale: frasi, pause, ritmo (funzioni pure)
  rehearsal/   piano di prova, regista e motore di riproduzione (indipendenti dal browser)
  speech/      voci di sistema, privacy rigorosa, Web Speech API
  db/          IndexedDB: copioni, impostazioni, backup, eliminazione
  ui/          interfaccia React
scripts/       controllo anti-documenti riservati, diagnostica PDF mascherata, generazione icone
```

### Pubblicazione (Cloudflare Pages, piano gratuito)

Sito statico, nessuna funzione lato server. Configurazione del progetto Pages collegato al
repository GitHub:

| Impostazione | Valore |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |
| Versione di Node | da `.node-version` (22) |

`public/_headers` imposta la Content Security Policy come intestazione HTTP, impedisce la
cache del service worker e rende permanente quella dei file con hash. Nessun Worker, nessuna
variabile d'ambiente, nessun servizio aggiuntivo.

**Aggiornamenti.** Il service worker scarica le nuove versioni in background; l'app controlla
all'apertura e quando torna in primo piano (non più di ogni 10 minuti, solo se c'è connessione).
Quando una versione è pronta compare l'avviso “Nuova versione disponibile” con “Aggiorna ora”.
Anche senza premerlo, l'aggiornamento si applica da solo al primo momento sicuro: con l'elenco dei
copioni aperto o con l'app in secondo piano. Mai durante una prova (anche in pausa o sul turno
dell'attore) né durante un'importazione: in quel caso viene rinviato. Un solo ricaricamento per
versione, nessun aggiornamento senza connessione. Copioni e impostazioni restano in IndexedDB e
non sono toccati dagli aggiornamenti; se in futuro lo schema dei dati cambiasse, la migrazione
dovrà conservarli.

### Protezione dei copioni nel repository

- `.gitignore` esclude PDF, documenti di testo, formati di sceneggiatura e backup dell'app.
- `.githooks/pre-commit` (attivato da `npm install`) esegue `scripts/check-sensitive.mjs`, che
  blocca il commit di documenti riconosciuti per estensione o per contenuto (firma PDF, Office,
  RTF), di file di ambiente e di file troppo grandi. Verifica manuale: `npm run check:sensitive -- --all`.
- I test usano solo dialoghi originali scritti per il progetto; i PDF di prova sono generati in
  memoria durante i test e non vengono mai salvati nel repository.

## Componenti di terze parti

| Componente | Licenza |
| --- | --- |
| [React](https://react.dev) | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | Apache-2.0 |
| [idb](https://github.com/jakearchibald/idb) | ISC |
| [Workbox](https://developer.chrome.com/docs/workbox) (via `vite-plugin-pwa`) | MIT |

Strumenti di sviluppo: Vite, TypeScript, Vitest, ESLint, fake-indexeddb, pdf-lib (licenze MIT/Apache-2.0).
