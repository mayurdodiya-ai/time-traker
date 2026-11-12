import { useState } from 'react';
import { api } from './api';
import { useToast } from './context';
import { Field, Modal } from './ui';

/** Owner-only: add a board list (in Chronos + Trello, or Chronos only), or rename a Chronos-only list. */
export default function LocalListModal({ project, list, kind: initialKind, canTrello = false, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(list?.name || '');
  const hasTrello = !!project.trello?.boardId && canTrello; // creating a REAL Trello list is for the owner / project manager
  const [kind, setKind] = useState(hasTrello ? (initialKind || 'both') : 'local'); // 'both' = created in Trello too | 'local' = Chronos only
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (list) await api.patch(`/projects/${project.id}/local-lists/${list.id}`, { name });
      else if (kind === 'both') await api.post(`/projects/${project.id}/lists`, { name });
      else await api.post(`/projects/${project.id}/local-lists`, { name });
      toast.success(list ? 'List renamed' : 'List added', !list && kind === 'both' ? 'It now exists in Chronos and on the Trello board.' : 'It exists only in Chronos. Trello is not changed.');
      onSaved?.();
      onClose();
    } catch (e) { toast.error('Could not save the list', e.message); } finally { setBusy(false); }
  };
  const opt = (value, title, text) => (
    <label key={value} className="row" style={{ gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 10, cursor: 'pointer', border: `1px solid ${kind === value ? 'var(--primary)' : 'var(--border)'}` }}>
      <input type="radio" name="list-kind" checked={kind === value} onChange={() => setKind(value)} style={{ marginTop: 3 }} />
      <span><b>{title}</b><span className="xs muted" style={{ display: 'block' }}>{text}</span></span>
    </label>
  );
  return (
    <Modal title={list ? 'Rename list' : 'Add a list'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : list ? 'Save' : 'Add list'}</button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="List name" hint={!hasTrello ? (project.trello?.boardId ? 'A column that exists only in Chronos. Trello is not changed; cards you drag here keep their Trello card where it is.' : 'A new column on this board, next to To Do, In Progress and the others. Drag cards into it.') : undefined}>
          <input className="input" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Backlog" onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} />
        </Field>
        {!list && hasTrello && (
          <div style={{ display: 'grid', gap: 8 }}>
            {opt('both', 'Chronos + Trello', 'The list is created on the Trello board too. Tasks you add to it get a Trello card.')}
            {opt('local', 'Chronos only', 'Only visible in Chronos. Tasks parked here keep their Trello card in its current Trello list.')}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Owner / project manager: give a status column (To Do, In Progress, ...) the name this project wants. Empty = back to the default name. */
export function StatusColumnModal({ project, status, defaultName, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(project.statusLabels?.[status] || defaultName);
  const [busy, setBusy] = useState(false);
  const save = async (value) => {
    setBusy(true);
    try { onSaved?.(await api.patch(`/projects/${project.id}/status-columns/${status}`, { name: value })); toast.success('Column renamed'); onClose(); }
    catch (e) { toast.error('Could not rename the column', e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Rename column" onClose={onClose}
      footer={<>
        {project.statusLabels?.[status] && <button className="btn" onClick={() => save('')} disabled={busy}>Reset to “{defaultName}”</button>}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => save(name)} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <Field label="Column name" hint="Only changes the name shown on this project's board. The status itself (and every report) stays the same.">
        <input className="input" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save(name)} />
      </Field>
    </Modal>
  );
}
