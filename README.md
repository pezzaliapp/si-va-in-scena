# SI VA IN SCENA

**Il tuo copione. La tua parte. Si va in scena.**

Progressive Web App per lo studio e le prove di copioni teatrali. L'attore importa il proprio
copione PDF, sceglie il personaggio che interpreta e ascolta le battute degli altri personaggi
lette da voci sintetiche; quando arriva il suo turno la lettura si ferma e attende.

Autore: **Alessandro Pezzali** · Licenza: [MIT](LICENSE)

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
   una battuta in didascalia e viceversa.
3. **Ruolo**: rispondi a *“Quale personaggio interpreti?”*. Puoi cambiarlo quando vuoi.
4. **Voci**: assegna una voce, velocità e intonazione a ogni personaggio e ascolta l'anteprima.
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
- **Intonazione** non supportata da tutte le voci.
- **Nessun riconoscimento vocale**: per proseguire dopo la tua battuta si usa “Continua”
  (o la barra spaziatrice). Il riconoscimento vocale dei browser è spesso remoto e non viene usato.

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
- **Riconoscimento**: il parser gestisce nomi in maiuscolo con `:`, `.` o `-`, nomi su una riga
  da soli, nomi “Nome:” ricorrenti, battute su più righe e su più pagine, didascalie tra
  parentesi (anche su più righe), atti e scene, battute corali (`TUTTI`, `A E B`), indicazioni
  “fuori scena” e “insieme”, intestazioni e numeri di pagina. Non distingue le didascalie in
  corsivo prive di parentesi (vengono segnalate come da verificare) e non gestisce dialoghi
  impaginati su due colonne affiancate.
- **Safari / iOS**:
  - la voce parte solo dopo un tocco dell'utente (per questo la prova inizia da “Avvia”);
  - con lo schermo bloccato o l'app in background la lettura si interrompe;
  - Safari può cancellare i dati dei siti non usati per 7 giorni: **installa l'app nella
    schermata Home** (Condividi → Aggiungi alla schermata Home) per proteggerli, ed esporta
    periodicamente un backup;
  - in rari casi Safari non segnala la fine di una frase: un timer di sicurezza fa proseguire la lettura.
- **Chrome / Edge**: le voci vengono caricate in modo asincrono; i testi lunghi vengono divisi
  in frasi per evitare interruzioni note del motore di sintesi.
- **Firefox**: non supporta l'installazione come PWA su desktop; l'app funziona comunque nel browser.

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
  rehearsal/   piano di prova e motore di riproduzione (indipendente dal browser)
  speech/      voci di sistema, privacy rigorosa, Web Speech API
  db/          IndexedDB: copioni, impostazioni, backup, eliminazione
  ui/          interfaccia React
scripts/       controllo anti-documenti riservati, generazione icone
```

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
