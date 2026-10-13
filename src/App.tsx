import { useEffect, useState } from 'react';
import { getPrefs, savePrefs } from './db/db';
import { DEFAULT_PREFS, type GlobalPrefs } from './types';
import { onUpdate } from './update';
import Library from './ui/Library';
import ScriptView, { type Tab } from './ui/ScriptView';

type View = { name: 'library' } | { name: 'script'; id: string; tab?: Tab };

export default function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const [prefs, setPrefs] = useState<GlobalPrefs>(DEFAULT_PREFS);
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);

  useEffect(() => onUpdate((apply) => setApplyUpdate(() => apply)), []);

  useEffect(() => {
    void getPrefs().then(setPrefs);
  }, []);

  const updatePrefs = (p: GlobalPrefs) => {
    setPrefs(p);
    void savePrefs(p);
  };

  return (
    <div className="app">
      {applyUpdate && (
        <div className="update-bar" role="status">
          <span>È disponibile una nuova versione. I tuoi copioni restano dove sono.</span>
          <button className="btn" onClick={applyUpdate}>
            Aggiorna
          </button>
        </div>
      )}
      {view.name === 'library' ? (
        <Library onOpen={(id, fresh) => setView({ name: 'script', id, tab: fresh ? 'review' : undefined })} />
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
