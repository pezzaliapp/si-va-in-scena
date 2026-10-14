import { useEffect, useState } from 'react';
import { getScript, getSettings, saveScript, saveSettings } from '../db/db';
import { loadVoices } from '../speech/voices';
import type { GlobalPrefs, Script, ScriptSettings } from '../types';
import Rehearsal from './Rehearsal';
import Review from './Review';
import RoleSelect from './RoleSelect';
import Study from './Study';
import Voices from './Voices';

export type Tab = 'review' | 'role' | 'voices' | 'rehearsal' | 'study';

const TABS: { id: Tab; label: string }[] = [
  { id: 'review', label: 'Verifica' },
  { id: 'role', label: 'Ruolo' },
  { id: 'voices', label: 'Voci' },
  { id: 'rehearsal', label: 'Prova' },
  { id: 'study', label: 'Studio' },
];

interface Props {
  scriptId: string;
  initialTab?: Tab;
  prefs: GlobalPrefs;
  onPrefs(p: GlobalPrefs): void;
  onClose(): void;
}

export default function ScriptView({ scriptId, initialTab, prefs, onPrefs, onClose }: Props) {
  const [script, setScript] = useState<Script | null>(null);
  const [settings, setSettings] = useState<ScriptSettings | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesReady, setVoicesReady] = useState(false);
  const [tab, setTab] = useState<Tab | null>(initialTab ?? null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void Promise.all([getScript(scriptId), getSettings(scriptId)]).then(([s, st]) => {
      if (!s) return setMissing(true);
      setScript(s);
      setSettings(st);
      setTab((t) => t ?? (st.role ? 'rehearsal' : 'role'));
    });
    void loadVoices().then((v) => {
      setVoices(v);
      setVoicesReady(true);
    });
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    const onChange = () => setVoices(synth?.getVoices() ?? []);
    synth?.addEventListener('voiceschanged', onChange);
    return () => {
      synth?.removeEventListener('voiceschanged', onChange);
      synth?.cancel();
    };
  }, [scriptId]);

  const updateScript = (s: Script) => {
    setScript(s);
    void saveScript(s);
  };
  const updateSettings = (patch: Partial<ScriptSettings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  };

  if (missing) {
    return (
      <main className="page">
        <p className="alert">Copione non trovato.</p>
        <button className="btn" onClick={onClose}>
          Torna ai copioni
        </button>
      </main>
    );
  }
  if (!script || !settings || !tab) return <main className="page" aria-busy="true" />;

  return (
    <main className="page wide">
      <header className="script-header">
        <button className="btn ghost back" onClick={onClose}>
          ← Copioni
        </button>
        <h1 className="script-heading">{script.title}</h1>
      </header>
      <nav className="tabs" aria-label="Sezioni del copione">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'review' && (
        <Review
          script={script}
          settings={settings}
          onChange={updateScript}
          onSettings={updateSettings}
          onDone={() => setTab('role')}
        />
      )}
      {tab === 'role' && (
        <RoleSelect
          script={script}
          role={settings.role}
          onSelect={(role) => {
            updateSettings({ role });
            setTab('voices');
          }}
        />
      )}
      {tab === 'voices' && (
        <Voices
          script={script}
          settings={settings}
          voices={voices}
          voicesReady={voicesReady}
          prefs={prefs}
          onPrefs={onPrefs}
          onChange={updateSettings}
          onScript={updateScript}
          onDone={() => setTab('rehearsal')}
        />
      )}
      {tab === 'rehearsal' && (
        <Rehearsal
          script={script}
          settings={settings}
          voices={voices}
          voicesReady={voicesReady}
          prefs={prefs}
          onChange={updateSettings}
        />
      )}
      {tab === 'study' && <Study script={script} role={settings.role} onChooseRole={() => setTab('role')} />}
    </main>
  );
}
