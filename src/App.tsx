import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPrefs, savePrefs } from './db/db';
import { DEFAULT_PREFS, type GlobalPrefs } from './types';
import { requestUpdate, setLibraryVisible, subscribeUpdate, updateState } from './update';
import Library from './ui/Library';
import ScriptView, { type Tab } from './ui/ScriptView';

type View = { name: 'library' } | { name: 'script'; id: string; tab?: Tab };

export default function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const [prefs, setPrefs] = useState<GlobalPrefs>(DEFAULT_PREFS);
  const update = useSyncExternalStore(subscribeUpdate, updateState);

  useEffect(() => setLibraryVisible(view.name === 'library'), [view.name]);

  useEffect(() => {
    void getPrefs().then(setPrefs);
  }, []);

  const updatePrefs = (p: GlobalPrefs) => {
    setPrefs(p);
    void savePrefs(p);
  };

  return (
    <div className="app">
      {update.available && (
        <div className="update-bar" role="status">
          {update.waitingFor ? (
            <span>
              Nuova versione disponibile: verrà applicata al termine{' '}
              {update.waitingFor === 'prova' ? 'della prova' : "dell'importazione"}.
            </span>
          ) : (
            <>
              <span>Nuova versione disponibile</span>
              <button className="btn" onClick={requestUpdate}>
                Aggiorna ora
              </button>
            </>
          )}
        </div>
      )}
      {view.name === 'library' ? (
        <Library
          prefs={prefs}
          onOpen={(id, fresh) => {
            // Subito, prima che termini l'importazione: l'aggiornamento non deve scattare nel passaggio.
            setLibraryVisible(false);
            setView({ name: 'script', id, tab: fresh ? 'review' : undefined });
          }}
        />
      ) : (
        <ScriptView
          key={view.id}
          scriptId={view.id}
          initialTab={view.tab}
          prefs={prefs}
          onPrefs={updatePrefs}
          onClose={() => setView({ name: 'library' })}
        />
      )}
    </div>
  );
}
