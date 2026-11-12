import { useState } from 'react';
import { AlertTriangle, Check, Download, ExternalLink, Link2, Plus } from 'lucide-react';
import { api } from './api';
import { useAuth, useTimer, useToast } from './context';
import { Field, Modal, Skeleton, useFetch } from './ui';

// Trello label colours (the "_dark" / "_light" variants share the base colour)
const COLORS = { green: '#61bd4f', yellow: '#f2d600', orange: '#ff9f1a', red: '#eb5a46', purple: '#c377e0', blue: '#0079bf', sky: '#00c2e0', lime: '#51e898', pink: '#ff78cb', black: '#344563' };
export const labelColor = (c = '') => COLORS[String(c).split('_')[0]] || '#8b90a8';
// Fallback text for a label with no custom name, e.g. "sky_dark" -> "Sky" — so a label is never just a bare, unreadable bar.
const labelText = (l) => l.name || (l.color ? String(l.color).split('_')[0].replace(/^\w/, (c) => c.toUpperCase()) : 'Label');

/** Coloured Trello labels. Always shows readable text — its own name, or its colour name (e.g. "Blue") as a fallback when it has none. */
export function LabelChips({ labels = [] }) {
  if (!labels?.length) return null;
  return (
    <div className="row wrap" style={{ gap: 4 }}>
      {labels.map((l, i) => (
        <span key={l.trelloId || i} className="lbl" style={{ '--c': labelColor(l.color) }} title={labelText(l)}>{labelText(l)}</span>
      ))}
    </div>
  );
}

/**
 * Pick labels from the board's labels (project.trello.labels). value = array of Trello label ids.
 * With `projectId`, the owner also gets "+ New label": it is created in Chronos AND on the Trello board.
 */
export function LabelPicker({ labels = [], value = [], onChange, projectId }) {
  const { user } = useAuth();
  const toast = useToast();
  const { bump } = useTimer();
  const [extra, setExtra] = useState([]); // labels created in this session (the project reloads in the background)
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [busy, setBusy] = useState(false);
  const all = [...labels, ...extra.filter((e) => !labels.some((l) => l.id === e.id))];
  const canCreate = !!projectId && user?.role === 'owner';
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const create = async () => {
    setBusy(true);
    try {
      const { label } = await api.post(`/projects/${projectId}/labels`, { name, color });
      setExtra((x) => [...x, label]);
      onChange([...value, label.id]);
      setName(''); setCreating(false);
      toast.success('Label created', 'It now exists in Chronos and on the Trello board.');
      bump();
    } catch (e) { toast.error('Could not create the label', e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="row wrap" style={{ gap: 6 }}>
        {!all.length && <span className="faint small">This board has no labels.</span>}
        {all.map((l) => {
          const on = value.includes(l.id);
          return (
            <button key={l.id} type="button" onClick={() => toggle(l.id)} aria-pressed={on} title={l.name || l.color}
              className="lbl pick" style={{ '--c': labelColor(l.color), opacity: on ? 1 : 0.45, outline: on ? '2px solid var(--text)' : 'none', outlineOffset: 1 }}>
              {on && <Check size={11} strokeWidth={3} />} {l.name || l.color}
            </button>
          );
        })}
        {canCreate && !creating && <button type="button" className="btn sm ghost" onClick={() => setCreating(true)}><Plus size={13} /> New label</button>}
      </div>
      {canCreate && creating && (
        <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 10 }}>
          <input className="input sm" autoFocus maxLength={40} placeholder="Label name, e.g. Bug" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { e.preventDefault(); create(); } }} />
          <div className="row wrap" style={{ gap: 6, margin: '8px 0' }}>
            {Object.keys(COLORS).map((c) => (
              <button key={c} type="button" title={c} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)}
                style={{ width: 24, height: 24, borderRadius: 6, background: COLORS[c], border: 0, cursor: 'pointer', outline: color === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm primary" onClick={create} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create label'}</button>
            <button type="button" className="btn sm" onClick={() => setCreating(false)} disabled={busy}>Cancel</button>
            <span className="xs faint">Also created on the Trello board.</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Import a Trello board as a project. */
export function TrelloImportModal({ onClose, onImported }) {
  const toast = useToast();
  const status = useFetch(() => api.get('/trello/status'), []);
  const boards = useFetch(() => (status.data?.configured && !status.data?.error ? api.get('/trello/boards') : Promise.resolve(null)), [status.data?.configured]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState('');

  const run = async (board, key) => {
    setBusy(key);
    try {
      const r = await api.post('/trello/import', { board });
      toast.success(`Imported “${r.name}”`, `${r.result.created} cards and ${r.result.subtasks} checklist items.`);
      onImported(r.id);
      onClose();
    } catch (e) { toast.error('Import failed', e.message); } finally { setBusy(''); }
  };

  const cfg = status.data;
  return (
    <Modal wide title="Import from Trello" onClose={onClose}>
      {!cfg ? <Skeleton h={90} /> : !cfg.configured ? (
        <div className="callout warn"><AlertTriangle size={18} style={{ flex: 'none' }} /><span>Trello isn’t connected yet. Add <b>TRELLO_KEY</b> and <b>TRELLO_TOKEN</b> to the server’s <b>.env</b> file and restart the app.</span></div>
      ) : cfg.error ? (
        <div className="callout danger"><AlertTriangle size={18} style={{ flex: 'none' }} /><span>{cfg.error}</span></div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="callout"><Link2 size={17} style={{ flex: 'none' }} /><span>Connected to Trello as <b>{cfg.account?.fullName}</b> (@{cfg.account?.username}). Lists become stages, cards become tasks, checklist items become subtasks, and labels are kept. Changes sync both ways.</span></div>
          <div>
            <div className="small bold" style={{ marginBottom: 8 }}>Boards this account can see</div>
            {!boards.data ? <Skeleton h={70} /> : boards.data.length === 0 ? <div className="faint small">No boards found.</div> : boards.data.map((b) => (
              <div key={b.id} className="task-row" style={{ cursor: 'default' }}>
                <div className="grow"><b>{b.name}</b><div className="xs faint">{b.workspace}</div></div>
                <a className="btn ghost icon sm" href={b.url} target="_blank" rel="noreferrer" aria-label="Open in Trello"><ExternalLink size={15} /></a>
                <button className="btn primary sm" disabled={!!busy || b.imported} onClick={() => run(b.id, b.id)}>
                  {b.imported ? 'Already imported' : busy === b.id ? 'Importing…' : <><Download size={14} /> Import</>}
                </button>
              </div>
            ))}
          </div>
          <Field label="Or paste a board link" hint="The board must be visible to the connected Trello account.">
            <div className="row">
              <input className="input" placeholder="https://trello.com/b/AbCd1234/my-board" value={link} onChange={(e) => setLink(e.target.value)} />
              <button className="btn primary" disabled={!!busy || !link.trim()} onClick={() => run(link.trim(), 'link')}>{busy === 'link' ? 'Importing…' : 'Import'}</button>
            </div>
          </Field>
        </div>
      )}
    </Modal>
  );
}
