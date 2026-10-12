import { useMemo, useRef, useState } from 'react';
import {
  addCharacter,
  deleteBlock,
  lineCounts,
  mergeCharacters,
  mergeWithPrevious,
  removeCharacter,
  renameCharacter,
  speakerLabel,
  splitBlock,
  updateBlock,
} from '../script/edit';
import { EVERYONE, type Block, type BlockKind, type Script } from '../types';

interface Props {
  script: Script;
  onChange(s: Script): void;
  onDone(): void;
}

const PAGE = 80;
const KIND_LABEL: Record<BlockKind, string> = { speech: 'Battuta', direction: 'Didascalia', heading: 'Atto / scena' };

export default function Review({ script, onChange, onDone }: Props) {
  const [onlyAmbiguous, setOnlyAmbiguous] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const counts = useMemo(() => lineCounts(script), [script]);
  const ambiguous = script.blocks.filter((b) => b.ambiguous).length;
  const visible = (onlyAmbiguous ? script.blocks.filter((b) => b.ambiguous) : script.blocks).slice(0, limit);
  const total = onlyAmbiguous ? ambiguous : script.blocks.length;

  return (
    <div className="stack">
      <section className="panel">
        <h2>Verifica il copione</h2>
        <p className="hint">
          Controlla che personaggi e battute siano stati riconosciuti correttamente. Le parti incerte sono segnalate:
          l’app non inventa nulla, ma può sbagliare l’attribuzione.
        </p>
        {script.warnings.map((w) => (
          <p key={w} className="notice">
            {w}
          </p>
        ))}
      </section>

      <section className="panel">
        <h3>Personaggi ({script.characters.length})</h3>
        <ul className="char-list">
          {script.characters.map((c) => (
            <li key={c.id} className="char-row">
              <input
                className="input"
                defaultValue={c.name}
                aria-label={`Nome del personaggio ${c.name}`}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== c.name) {
                    onChange(renameCharacter(script, c.id, e.target.value));
                  }
                }}
              />
              <span className="count">{counts.get(c.id) ?? 0} battute</span>
              {script.characters.length > 1 && (
                <select
                  className="select"
                  value=""
                  aria-label={`Unisci ${c.name} a un altro personaggio`}
                  onChange={(e) => {
                    const target = script.characters.find((x) => x.id === e.target.value);
                    if (target && confirm(`Unire "${c.name}" a "${target.name}"?`)) {
                      onChange(mergeCharacters(script, c.id, target.id));
                    }
                  }}
                >
                  <option value="">Unisci a…</option>
                  {script.characters
                    .filter((x) => x.id !== c.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              )}
              {!counts.get(c.id) && (
                <button className="btn ghost danger" onClick={() => onChange(removeCharacter(script, c.id))}>
                  Rimuovi
                </button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            onChange(addCharacter(script, newName).script);
            setNewName('');
          }}
        >
          <input
            className="input"
            placeholder="Nuovo personaggio"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="Nome del nuovo personaggio"
          />
          <button className="btn" type="submit">
            Aggiungi
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="row spread">
          <h3>Testo ({total})</h3>
          <label className="check">
            <input type="checkbox" checked={onlyAmbiguous} onChange={(e) => setOnlyAmbiguous(e.target.checked)} />
            Solo da verificare ({ambiguous})
          </label>
        </div>
        <ol className="blocks">
          {visible.map((b) =>
            editing === b.id ? (
              <BlockEditor
                key={b.id}
                block={b}
                script={script}
                onChange={onChange}
                onClose={() => setEditing(null)}
              />
            ) : (
              <li key={b.id} className={`block ${b.kind} ${b.ambiguous ? 'flagged' : ''}`}>
                <button className="block-view" onClick={() => setEditing(b.id)}>
                  {b.kind === 'speech' && (
                    <span className="speaker">
                      {speakerLabel(script, b.speakers)}
                      {b.note ? <span className="note"> ({b.note})</span> : null}
                    </span>
                  )}
                  <span className="text">{b.text || '—'}</span>
                  {b.ambiguous && <span className="flag">⚠ {b.ambiguous}</span>}
                </button>
              </li>
            ),
          )}
        </ol>
        {visible.length < total && (
          <button className="btn block" onClick={() => setLimit((l) => l + PAGE * 2)}>
            Mostra altro ({total - visible.length} rimanenti)
          </button>
        )}
      </section>

      <button className="btn primary large block" onClick={onDone}>
        Il copione è corretto: scegli il ruolo
      </button>
    </div>
  );
}

function BlockEditor({
  block,
  script,
  onChange,
  onClose,
}: {
  block: Block;
  script: Script;
  onChange(s: Script): void;
  onClose(): void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(block.text);
  const index = script.blocks.findIndex((b) => b.id === block.id);
  const commitText = (s: Script) => (text !== block.text ? updateBlock(s, block.id, { text }) : s);
  const toggleSpeaker = (id: string) => {
    const has = block.speakers.includes(id);
    const speakers = has ? block.speakers.filter((s) => s !== id) : [...block.speakers, id];
    onChange(updateBlock(commitText(script), block.id, { speakers }));
  };

  return (
    <li className="block editing">
      <div className="row wrap">
        <label className="field">
          Tipo
          <select
            className="select"
            value={block.kind}
            onChange={(e) => onChange(updateBlock(commitText(script), block.id, { kind: e.target.value as BlockKind }))}
          >
            {(Object.keys(KIND_LABEL) as BlockKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {block.kind === 'heading' && (
          <label className="field">
            Livello
            <select
              className="select"
              value={block.level ?? 1}
              onChange={(e) => onChange(updateBlock(script, block.id, { level: Number(e.target.value) as 1 | 2 }))}
            >
              <option value={1}>Atto</option>
              <option value={2}>Scena</option>
            </select>
          </label>
        )}
      </div>

      {block.kind === 'speech' && (
        <fieldset className="speakers">
          <legend>Chi parla</legend>
          {script.characters.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={block.speakers.includes(c.id)} onChange={() => toggleSpeaker(c.id)} />
              {c.name}
            </label>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={block.speakers.includes(EVERYONE)}
              onChange={() => toggleSpeaker(EVERYONE)}
            />
            Tutti
          </label>
        </fieldset>
      )}

      <label className="field">
        Testo
        <textarea
          ref={textRef}
          className="input textarea"
          value={text}
          rows={Math.min(10, Math.max(3, Math.ceil(text.length / 60)))}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== block.text && onChange(updateBlock(script, block.id, { text }))}
        />
      </label>
      <p className="hint">Per dividere: posiziona il cursore nel testo e tocca “Dividi qui”.</p>

      <div className="row wrap">
        <button
          className="btn"
          onClick={() => {
            const at = textRef.current?.selectionStart ?? 0;
            onChange(splitBlock(commitText(script), block.id, at));
          }}
        >
          Dividi qui
        </button>
        {index > 0 && (
          <button className="btn" onClick={() => onChange(mergeWithPrevious(commitText(script), block.id))}>
            Unisci al precedente
          </button>
        )}
        {block.ambiguous && (
          <button
            className="btn"
            onClick={() => onChange(updateBlock(commitText(script), block.id, { ambiguous: undefined }))}
          >
            Segna come verificato
          </button>
        )}
        <button
          className="btn danger"
          onClick={() => confirm('Eliminare questo passaggio?') && onChange(deleteBlock(script, block.id))}
        >
          Elimina
        </button>
        <button
          className="btn primary"
          onClick={() => {
            if (text !== block.text) onChange(updateBlock(script, block.id, { text }));
            onClose();
          }}
        >
          Fatto
        </button>
      </div>
    </li>
  );
}
