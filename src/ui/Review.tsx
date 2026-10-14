import { useMemo, useRef, useState } from 'react';
import {
  addCharacter,
  deleteBlock,
  lineCounts,
  mergeCharacters,
  mergeWithPrevious,
  removeCharacter,
  renameCharacter,
  setCharacterVoice,
  speakerLabel,
  splitBlock,
  updateBlock,
} from '../script/edit';
import { CUE_STYLE_LABEL } from '../parser/parse';
import { mergeSettings, suggestMerges } from '../script/similar';
import {
  EVERYONE,
  type Block,
  type BlockKind,
  type CueStyle,
  type Script,
  type ScriptSettings,
  type VoiceGender,
} from '../types';

interface Props {
  script: Script;
  settings: ScriptSettings;
  onChange(s: Script): void;
  onSettings(patch: Partial<ScriptSettings>): void;
  onDone(): void;
}

/** Nome della voce di sistema, per i conflitti tra impostazioni. */
function voiceName(uri: string | null | undefined): string {
  if (!uri) return 'voce predefinita';
  const v =
    typeof window !== 'undefined' ? window.speechSynthesis?.getVoices().find((x) => x.voiceURI === uri) : undefined;
  return v?.name ?? 'voce non disponibile su questo dispositivo';
}

const PAGE = 80;
const KIND_LABEL: Record<BlockKind, string> = {
  speech: 'Battuta',
  direction: 'Didascalia',
  heading: 'Atto / scena',
  front: 'Frontespizio / crediti',
  cast: 'Elenco personaggi',
};

export default function Review({ script, settings, onChange, onSettings, onDone }: Props) {
  const [onlyAmbiguous, setOnlyAmbiguous] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const counts = useMemo(() => lineCounts(script), [script]);
  const ambiguous = script.blocks.filter((b) => b.ambiguous).length;
  const visible = (onlyAmbiguous ? script.blocks.filter((b) => b.ambiguous) : script.blocks).slice(0, limit);
  const total = onlyAmbiguous ? ambiguous : script.blocks.length;
  const suggestions = useMemo(() => suggestMerges(script, script.dismissedMerges), [script]);
  const suspects = new Set(suggestions.map((sg) => sg.fromId));
  // I nomi da controllare per primi; gli altri nell'ordine del copione.
  const characters = [...script.characters].sort((a, b) => +suspects.has(b.id) - +suspects.has(a.id));
  const [conflict, setConflict] = useState<{ from: string; into: string } | null>(null);
  const [manual, setManual] = useState({ from: '', into: '' });
  const nameOf = (id: string) => script.characters.find((c) => c.id === id)?.name ?? '';

  // Unione: battute invariate; ruolo e voce passano al personaggio unito.
  // Se entrambi hanno una voce diversa, si chiede quale tenere.
  const merge = (from: string, into: string, keep?: 'into' | 'from') => {
    const outcome = mergeSettings(settings, from, into, keep);
    if (outcome.voiceConflict && !keep) return setConflict({ from, into });
    setConflict(null);
    onChange(mergeCharacters(script, from, into));
    onSettings({ role: outcome.settings.role, voices: outcome.settings.voices });
  };
  const dismiss = (id: string) => onChange({ ...script, dismissedMerges: [...(script.dismissedMerges ?? []), id] });
  const firstLine = (id: string) => script.blocks.find((b) => b.kind === 'speech' && b.speakers.includes(id))?.text;

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
        {script.stats && <Diagnostics stats={script.stats} />}
      </section>

      {conflict && (
        <section className="panel notice" role="alert">
          <p>
            «{nameOf(conflict.from)}» e «{nameOf(conflict.into)}» hanno voci diverse. Quale tenere per{' '}
            {nameOf(conflict.into)}?
          </p>
          <div className="row wrap">
            <button className="btn" onClick={() => merge(conflict.from, conflict.into, 'into')}>
              {voiceName(settings.voices[conflict.into]?.voiceURI)} (di {nameOf(conflict.into)})
            </button>
            <button className="btn" onClick={() => merge(conflict.from, conflict.into, 'from')}>
              {voiceName(settings.voices[conflict.from]?.voiceURI)} (di {nameOf(conflict.from)})
            </button>
            <button className="btn ghost" onClick={() => setConflict(null)}>
              Annulla
            </button>
          </div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="panel">
          <h3>Nomi da controllare ({suggestions.length})</h3>
          <p className="hint">
            Questi nomi compaiono in poche battute e somigliano molto a un altro personaggio: potrebbero essere errori
            di battitura o di lettura del PDF. Nulla viene unito senza la tua conferma e il testo delle battute non
            cambia.
          </p>
          <ul className="char-list">
            {suggestions.map((sg) => (
              <li key={sg.fromId} className="suggestion">
                <p>
                  <strong>{nameOf(sg.fromId)}</strong> ({counts.get(sg.fromId) ?? 0}{' '}
                  {counts.get(sg.fromId) === 1 ? 'battuta' : 'battute'}) potrebbe essere{' '}
                  {sg.intoIds.map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ' oppure ' : ''}
                      <strong>{nameOf(id)}</strong> ({counts.get(id) ?? 0}{' '}
                      {counts.get(id) === 1 ? 'battuta' : 'battute'})
                    </span>
                  ))}
                  .
                </p>
                {firstLine(sg.fromId) && <p className="hint">Battuta: «{firstLine(sg.fromId)!.slice(0, 120)}»</p>}
                <div className="row wrap">
                  {sg.intoIds.map((id) => (
                    <button key={id} className="btn" onClick={() => merge(sg.fromId, id)}>
                      Unisci in {nameOf(id)}
                    </button>
                  ))}
                  <button className="btn ghost" onClick={() => dismiss(sg.fromId)}>
                    Non è un errore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h3>Personaggi ({script.characters.length})</h3>
        <ul className="char-list">
          {characters.map((c) => (
            <li key={c.id} className={`char-row${suspects.has(c.id) ? ' suspect' : ''}`}>
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
              <span className="count">
                {counts.get(c.id) ?? 0} {counts.get(c.id) === 1 ? 'battuta' : 'battute'}
                {suspects.has(c.id) ? ' · da controllare' : ''}
              </span>
              <select
                className="select"
                value={c.voice ?? ''}
                aria-label={`Voce desiderata per ${c.name}`}
                onChange={(e) =>
                  onChange(setCharacterVoice(script, c.id, (e.target.value || undefined) as VoiceGender | undefined))
                }
              >
                <option value="">Voce: da scegliere</option>
                <option value="m">Voce maschile</option>
                <option value="f">Voce femminile</option>
              </select>
              {!counts.get(c.id) && (
                <button className="btn ghost danger" onClick={() => onChange(removeCharacter(script, c.id))}>
                  Rimuovi
                </button>
              )}
            </li>
          ))}
        </ul>
        {script.characters.length > 1 && (
          <details className="manual-merge">
            <summary>Unisci due personaggi</summary>
            <p className="hint">Per un errore non segnalato: le battute del primo passano al secondo.</p>
            <div className="row wrap">
              {(['from', 'into'] as const).map((k) => (
                <select
                  key={k}
                  className="select"
                  value={manual[k]}
                  aria-label={k === 'from' ? 'Personaggio da unire' : 'Unisci in'}
                  onChange={(e) => setManual({ ...manual, [k]: e.target.value })}
                >
                  <option value="">{k === 'from' ? 'Personaggio…' : 'Unisci in…'}</option>
                  {script.characters
                    .filter((x) => x.id !== (k === 'from' ? manual.into : manual.from))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              ))}
              <button
                className="btn"
                disabled={!manual.from || !manual.into}
                onClick={() => {
                  if (confirm(`Unire "${nameOf(manual.from)}" a "${nameOf(manual.into)}"?`)) {
                    merge(manual.from, manual.into);
                    setManual({ from: '', into: '' });
                  }
                }}
              >
                Unisci
              </button>
            </div>
          </details>
        )}
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

/** Dati di lettura del PDF, senza testo: aiutano a capire un riconoscimento non riuscito. */
function Diagnostics({ stats }: { stats: NonNullable<Script['stats']> }) {
  const formats = (Object.entries(stats.formats) as [CueStyle, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <details className="diagnostics">
      <summary>Dati di lettura del PDF</summary>
      <ul>
        <li>Pagine con testo: {stats.pages}</li>
        <li>Righe estratte: {stats.lines}</li>
        <li>Battute riconosciute: {stats.speeches}</li>
        {formats.map(([f, n]) => (
          <li key={f}>
            Formato «{CUE_STYLE_LABEL[f]}»: {n}
          </li>
        ))}
        <li>Paragrafi senza personaggio da verificare: {stats.unattributed}</li>
      </ul>
      <p className="hint">Questi dati restano sul dispositivo.</p>
    </details>
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
