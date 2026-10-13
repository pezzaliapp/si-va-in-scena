import { useEffect, useRef, useState } from 'react';
import {
  deleteAllData,
  deleteScript,
  exportBackup,
  importBackup,
  listScripts,
  requestPersistence,
  saveScript,
  type ScriptSummary,
} from '../db/db';

interface Props {
  onOpen(id: string, fresh: boolean): void;
}

const FEEDBACK_URL = 'https://github.com/pezzaliapp/si-va-in-scena/issues/new?template=feedback.yml';

const STORAGE_BLOCKED =
  'Il browser non permette a questa app di salvare dati sul dispositivo, quindi il copione non può essere conservato. ' +
  'Il PDF non è la causa. In Chrome: icona a sinistra dell\'indirizzo → Impostazioni sito → consenti "Cookie e dati dei siti", poi ricarica la pagina. ' +
  'In Safari: disattiva "Blocca tutti i cookie". In navigazione privata alcuni browser non salvano i dati.';

/** Messaggio per un errore di IndexedDB. */
function storageMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === 'QuotaExceededError') {
    return 'Spazio di archiviazione del browser esaurito: elimina qualche copione o libera spazio sul dispositivo.';
  }
  return `${STORAGE_BLOCKED} (Dettaglio tecnico: ${technicalDetail(err)})`;
}

/** Nome e messaggio dell'errore, senza testo del copione, da riportare in una segnalazione. */
function technicalDetail(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 160);
  return String(err).slice(0, 160);
}

const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

export default function Library({ onOpen }: Props) {
  const [scripts, setScripts] = useState<ScriptSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const refresh = () =>
    listScripts().then(setScripts, (err: unknown) => {
      console.error(err);
      setError(storageMessage(err));
    });
  useEffect(() => {
    void refresh();
  }, []);

  async function onPdf(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setBusy('Lettura del copione…');
    let script;
    try {
      // PDF.js viene caricato solo quando serve.
      const { ImportError, importPdf } = await import('../pdf/load');
      try {
        script = await importPdf(file, (p, total) => setBusy(`Lettura pagina ${p} di ${total}…`));
      } catch (err) {
        if (err instanceof ImportError) {
          setError(err.message);
          return;
        }
        throw err;
      }
    } catch (err) {
      console.error(err);
      setError(
        "Problema tecnico dell'app durante la lettura del PDF: il file potrebbe essere corretto. " +
          `Ricarica la pagina e riprova; se si ripete, segnalalo riportando questo dettaglio: ${technicalDetail(err)}`,
      );
      return;
    } finally {
      setBusy(null);
    }
    try {
      await saveScript(script);
    } catch (err) {
      console.error(err);
      setError(storageMessage(err));
      return;
    }
    void requestPersistence();
    onOpen(script.id, true);
  }

  async function onDelete(s: ScriptSummary) {
    if (!confirm(`Eliminare "${s.title}" e tutti i dati collegati da questo dispositivo?`)) return;
    await deleteScript(s.id);
    await refresh();
  }

  async function onExport() {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `si-va-in-scena-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Backup creato. Il file contiene il testo dei tuoi copioni: conservalo in un luogo sicuro.');
  }

  async function onImportBackup(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const n = await importBackup(JSON.parse(await file.text()));
      setNotice(`Backup ripristinato: ${n} ${n === 1 ? 'copione' : 'copioni'}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Il file non è un backup valido.' : (err as Error).message);
    }
  }

  async function onDeleteAll() {
    if (!confirm('Eliminare definitivamente tutti i copioni e le impostazioni da questo dispositivo?')) return;
    await deleteAllData();
    setNotice('Tutti i dati sono stati eliminati.');
    await refresh();
  }

  return (
    <main className="page">
      <header className="masthead">
        <h1 className="brand">
          SI VA IN SCENA <span className="beta-badge">Beta</span>
        </h1>
        <p className="tagline">Il tuo copione. La tua parte. Si va in scena.</p>
      </header>

      <section className="panel">
        <button className="btn primary large block" onClick={() => pdfInput.current?.click()} disabled={!!busy}>
          Importa un copione PDF
        </button>
        <input
          ref={pdfInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            void onPdf(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <p className="hint">Il PDF viene letto solo su questo dispositivo. Nessun file viene inviato a server esterni.</p>
        {busy && (
          <p className="status" role="status">
            {busy}
          </p>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </section>

      <section>
        <h2>I tuoi copioni</h2>
        {scripts === null ? null : scripts.length === 0 ? (
          <p className="empty">Nessun copione ancora. Importa un PDF per iniziare.</p>
        ) : (
          <ul className="script-list">
            {scripts.map((s) => (
              <li key={s.id} className="script-item">
                <button className="script-open" onClick={() => onOpen(s.id, false)}>
                  <span className="script-title">{s.title}</span>
                  <span className="script-meta">
                    {s.role ? `Interpreti ${s.role}` : 'Ruolo da scegliere'} · {s.characterCount} personaggi ·{' '}
                    {dateFmt.format(s.updatedAt)}
                  </span>
                </button>
                <button className="btn ghost danger" onClick={() => void onDelete(s)} aria-label={`Elimina ${s.title}`}>
                  Elimina
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel subtle">
        <h2>Versione beta</h2>
        <p className="hint">
          L'app è in prova. Il riconoscimento dei copioni PDF non è perfetto: controlla sempre personaggi e battute
          nella scheda Verifica e correggi ciò che serve. Le voci sono quelle del tuo dispositivo: pause e ritmo sono
          regolabili, ma l'espressività dipende dalla voce installata.
        </p>
        <p className="hint">
          <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
            Segnala un problema o lascia un suggerimento
          </a>{' '}
          (GitHub, richiede un account gratuito). Non allegare il PDF né parti del copione: descrivi il problema con
          parole tue.
        </p>
      </section>

      <section className="panel subtle">
        <h2>Dati e privacy</h2>
        <p className="hint">
          Copioni e impostazioni restano in questo browser. Nessun account, nessuna sincronizzazione cloud, nessun
          tracciamento. Per spostarli su un altro dispositivo usa il backup.
        </p>
        <div className="row wrap">
          <button className="btn" onClick={() => void onExport()} disabled={!scripts?.length}>
            Esporta backup
          </button>
          <button className="btn" onClick={() => backupInput.current?.click()}>
            Ripristina backup
          </button>
          <button className="btn danger" onClick={() => void onDeleteAll()}>
            Elimina tutti i dati
          </button>
        </div>
        <input
          ref={backupInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            void onImportBackup(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </section>

      <footer className="footer">
        SI VA IN SCENA · © Alessandro Pezzali · Software libero con licenza MIT
      </footer>
    </main>
  );
}
