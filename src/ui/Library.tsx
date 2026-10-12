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

const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

export default function Library({ onOpen }: Props) {
  const [scripts, setScripts] = useState<ScriptSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const refresh = () => listScripts().then(setScripts);
  useEffect(() => {
    void refresh();
  }, []);

  async function onPdf(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setBusy('Lettura del copione…');
    // PDF.js viene caricato solo quando serve.
    const { ImportError, importPdf } = await import('../pdf/load');
    try {
      const script = await importPdf(file, (p, total) => setBusy(`Lettura pagina ${p} di ${total}…`));
      await saveScript(script);
      void requestPersistence();
      onOpen(script.id, true);
    } catch (err) {
      setError(err instanceof ImportError ? err.message : 'Impossibile leggere il PDF.');
      console.error(err);
    } finally {
      setBusy(null);
    }
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
        <h1 className="brand">SI VA IN SCENA</h1>
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
