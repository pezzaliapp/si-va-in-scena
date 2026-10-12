import { useMemo } from 'react';
import { lineCounts } from '../script/edit';
import type { Script } from '../types';

interface Props {
  script: Script;
  role: string | null;
  onSelect(role: string | null): void;
}

export default function RoleSelect({ script, role, onSelect }: Props) {
  const counts = useMemo(() => lineCounts(script), [script]);
  const sorted = [...script.characters].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));

  return (
    <section className="panel">
      <h2>Quale personaggio interpreti?</h2>
      <p className="hint">Puoi cambiarlo quando vuoi, senza importare di nuovo il PDF.</p>
      <div className="role-grid">
        {sorted.map((c) => (
          <button
            key={c.id}
            className={`role ${role === c.id ? 'selected' : ''}`}
            aria-pressed={role === c.id}
            onClick={() => onSelect(c.id)}
          >
            <span className="role-name">{c.name}</span>
            <span className="role-count">{counts.get(c.id) ?? 0} battute</span>
          </button>
        ))}
      </div>
      {script.characters.length === 0 && (
        <p className="notice">Nessun personaggio disponibile: aggiungili nella sezione Verifica.</p>
      )}
      <button className={`btn ghost block ${role === null ? 'selected' : ''}`} onClick={() => onSelect(null)}>
        Nessuno: voglio solo ascoltare
      </button>
    </section>
  );
}
