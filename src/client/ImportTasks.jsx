import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload, AlertTriangle, Check, RotateCcw } from 'lucide-react';
import { api } from './api';
import { useToast } from './context';
import { Modal, Select } from './ui';
import { STATUS } from './format';

/**
 * Admin-only bulk import: upload an .xlsx sheet -> preview + per-row validation -> create the tasks.
 * Nothing is created until the admin confirms the preview; bad rows are reported and skipped, never block the rest.
 */
export default function ImportTasksModal({ project, defaultListId, defaultStatus, onClose, onDone }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const linked = !!project.trello?.boardId;
  const lists = [...(project.trello?.lists || []), ...(project.localLists || []).map((l) => ({ ...l, local: true }))];
  const hasLists = lists.length > 0; // any board list (Trello list or custom list) -> the sheet's List column and the default-list choice apply
  const [file, setFile] = useState(null);
  const [defaultList, setDefaultList] = useState(defaultListId || (linked ? lists[0]?.id : '') || ''); // only used for rows whose List cell is empty
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [preview, setPreview] = useState(null); // { rows, ignoredColumns }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [outcome, setOutcome] = useState(null); // { created, skipped, failed, problems: [{ n, title, error }] }

  const runPreview = async (f, listId) => {
    setBusy(true);
    try {
      setPreview(await api.upload('/tasks/import/preview', f, { project: project.id, defaultList: listId || undefined, defaultStatus }));
    } catch (e) { toast.error('Could not read the file', e.message); setPreview(null); } finally { setBusy(false); }
  };
  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    runPreview(f, defaultList);
  };
  const changeList = (id) => { setDefaultList(id); if (file) runPreview(file, id); };

  const downloadTemplate = async () => {
    try { await api.download(`/tasks/import/template?project=${project.id}`, `${project.name.replace(/[^\w-]+/g, '_')}-task-import-template.xlsx`); }
    catch (e) { toast.error('Could not download the template', e.message); }
  };

  const rows = preview?.rows || [];
  const valid = rows.filter((r) => !r.errors.length);
  const invalid = rows.length - valid.length;
  const dupes = valid.filter((r) => r.duplicate).length;

  const start = async () => {
    const chunkSize = linked ? 5 : 25; // Trello needs several API calls per task, so keep each request short
    const viewOf = new Map(rows.map((r) => [r.n, r.view]));
    const out = { created: 0, skipped: 0, failed: invalid, createdRows: [], problems: rows.filter((r) => r.errors.length).map((r) => ({ n: r.n, title: r.view.title, kind: 'failed', error: r.errors.join('; ') })) };
    const assigned = {};
    let processed = 0;
    setBusy(true);
    setProgress({ done: 0, total: valid.length });
    try {
      for (let i = 0; i < valid.length; i += chunkSize) {
        const chunk = valid.slice(i, i + chunkSize);
        const r = await api.post('/tasks/import/commit', { project: project.id, rows: chunk.map((x) => x.raw), defaultList: defaultList || undefined, defaultStatus, skipDuplicates });
        for (const x of r.results) {
          const v = viewOf.get(x.n) || {};
          if (x.status === 'created') { out.created += 1; out.createdRows.push({ n: x.n, ...v }); }
          else if (x.status === 'skipped') { out.skipped += 1; out.problems.push({ n: x.n, title: v.title, kind: 'skipped', error: 'Already exists in this list' }); }
          else { out.failed += 1; out.problems.push({ n: x.n, title: v.title, kind: 'failed', error: x.error }); }
        }
        for (const [uid, n] of Object.entries(r.assigned || {})) assigned[uid] = (assigned[uid] || 0) + n;
        processed += chunk.length;
        setProgress({ done: processed, total: valid.length });
      }
    } catch (e) {
      toast.error('Import stopped', `${e.message} Rows already imported were kept.`);
      out.failed += valid.length - processed;
      out.problems.push({ n: '—', title: `${valid.length - processed} remaining row(s)`, kind: 'failed', error: `Not imported: ${e.message}` });
    }
    try { await api.post('/tasks/import/finish', { project: project.id, created: out.created, skipped: out.skipped, failed: out.failed, assigned }); } catch { /* summary only */ }
    setBusy(false);
    setProgress(null);
    setOutcome(out);
    if (out.created) onDone?.();
  };

  if (outcome) {
    const ok = outcome.created > 0 && outcome.failed === 0;
    const tone = ok ? 'var(--success)' : outcome.created > 0 ? 'var(--warn)' : 'var(--danger)';
    const byList = {};
    outcome.createdRows.forEach((r) => { const k = r.list || 'No list'; byList[k] = (byList[k] || 0) + 1; });
    const people = new Set(outcome.createdRows.map((r) => r.assignee).filter(Boolean)).size;
    const subs = outcome.createdRows.reduce((n, r) => n + (r.subtasks || 0), 0);
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const again = () => { setOutcome(null); setFile(null); setPreview(null); };
    return (
      <Modal title="Import finished" onClose={onClose} wide
        footer={<>
          <button className="btn" onClick={again}><RotateCcw size={15} /> Import another file</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </>}>
        <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 16 }}>
          <span style={{ width: 48, height: 48, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${tone} 18%, transparent)`, color: tone }}>
            {ok || outcome.created > 0 ? <Check size={26} /> : <AlertTriangle size={26} />}
          </span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{outcome.created > 0 ? `${plural(outcome.created, 'task')} imported` : 'Nothing was imported'}</div>
            <div className="small muted">
              {outcome.created > 0
                ? `Added to ${plural(Object.keys(byList).length, 'list')}${people ? `, assigned to ${plural(people, 'person').replace('persons', 'people')}` : ''}${subs ? `, with ${plural(subs, 'subtask')} from your sheet` : ''}.`
                : 'No new tasks were created. See the details below.'}
            </div>
          </div>
        </div>

        {(outcome.skipped > 0 || outcome.failed > 0) && (
          <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
            {outcome.skipped > 0 && <span className="chip warn">{plural(outcome.skipped, 'task')} skipped — already exist</span>}
            {outcome.failed > 0 && <span className="chip danger"><AlertTriangle size={11} /> {outcome.failed} not imported</span>}
          </div>
        )}

        {outcome.created > 0 && (
          <>
            <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
              <span className="xs faint">Where they went:</span>
              {Object.entries(byList).map(([k, n]) => <span key={k} className="chip">{k}: {n}</span>)}
            </div>
            <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="table">
                <thead><tr><th>Task</th>{hasLists && <th>List</th>}<th>Assignee</th><th>Priority</th></tr></thead>
                <tbody>{outcome.createdRows.map((r) => (
                  <tr key={r.n}><td>{r.title}</td>{hasLists && <td>{r.list}</td>}<td>{r.assignee || <span className="faint">Unassigned</span>}</td><td>{r.priority}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}

        {outcome.problems.length > 0 && (
          <>
            <div style={{ fontWeight: 600, margin: '16px 0 6px' }}>Needs attention</div>
            <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table className="table">
                <thead><tr><th>Row</th><th>Task</th><th>Reason</th></tr></thead>
                <tbody>{outcome.problems.map((p, i) => <tr key={`${p.n}-${i}`}><td>{p.n}</td><td>{p.title || '—'}</td><td className="xs" style={{ color: p.kind === 'skipped' ? 'var(--warn)' : 'var(--danger)' }}>{p.error}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="xs faint" style={{ marginTop: 8 }}>Fix these rows in your sheet and upload it again — tasks that were already created are skipped automatically.</p>
          </>
        )}
      </Modal>
    );
  }

  const perList = {};
  valid.forEach((r) => { const k = r.view.list || '—'; perList[k] = (perList[k] || 0) + 1; });
  const step = (n, done) => <span style={{ width: 24, height: 24, borderRadius: 999, flex: 'none', display: 'inline-grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: done ? 'var(--success)' : 'var(--primary)', color: done ? 'var(--on-success)' : 'var(--on-primary)' }}>{done ? <Check size={13} /> : n}</span>;
  const box = { border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--surface-2)' };

  return (
    <Modal title="Import tasks from Excel" onClose={busy ? () => {} : onClose} wide
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={start} disabled={busy || !valid.length}>
          {progress ? `Importing ${progress.done}/${progress.total}…` : `Import ${valid.length} task${valid.length === 1 ? '' : 's'}`}
        </button>
      </>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={box}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            {step(1, !!file)}
            <div style={{ flex: 1 }}>
              <b>Download the example file first</b>
              <p className="small muted" style={{ margin: '4px 0 10px' }}>
                Fill in <b>one row per task</b>. Use the <b>List</b> column to choose where each task goes — one file can hold tasks for <b>several lists</b>. Assignees, priorities and lists are available as dropdowns in the file.
              </p>
              {hasLists && (
                <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
                  <span className="xs faint">Lists on this board:</span>
                  {lists.map((l) => <span key={l.id} className="chip">{l.name}{l.local ? ' (Chronos only)' : ''}</span>)}
                </div>
              )}
              <button className="btn" onClick={downloadTemplate}><Download size={15} /> Download example file (.xlsx)</button>
            </div>
          </div>
        </div>

        <div style={box}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            {step(2, !!preview)}
            <div style={{ flex: 1 }}>
              <b>Upload your filled file</b>
              <p className="small muted" style={{ margin: '4px 0 10px' }}>Up to 200 tasks. You can check everything before anything is created.</p>
              <div className="row wrap" style={{ gap: 8 }}>
                <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={pick} />
                <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15} /> {file ? 'Choose another file' : 'Choose .xlsx file'}</button>
                {file && <span className="xs faint"><FileSpreadsheet size={13} style={{ verticalAlign: -2 }} /> {file.name}</span>}
              </div>
              {hasLists && (
                <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
                  <span className="xs muted">If a row has no List, put it in</span>
                  <Select className="sm" style={{ width: 220 }} value={defaultList} onChange={(e) => changeList(e.target.value)} disabled={busy}>{!linked && <option value="">Status columns (no list)</option>}{lists.map((l) => <option key={l.id} value={l.id}>{l.name}{l.local && linked ? ' (Chronos only)' : ''}</option>)}</Select>
                </div>
              )}
              {defaultStatus && <p className="xs muted" style={{ margin: '12px 0 0' }}>Rows without a Status are added as <b>{project.statusLabels?.[defaultStatus] || STATUS[defaultStatus]?.label}</b>.</p>}
              <label className="row xs muted" style={{ gap: 6, marginTop: 10 }}><input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} disabled={busy} /> Skip tasks whose title already exists in the same list</label>
            </div>
          </div>
        </div>
      </div>

      {preview && (
        <>
          <div className="row" style={{ gap: 10, margin: '16px 0 8px' }}>{step(3, false)}<b>Check the tasks, then import</b></div>
          <div className="row wrap" style={{ gap: 8, margin: '0 0 8px' }}>
            <span className="chip"><Check size={11} /> {valid.length} ready</span>
            {hasLists && Object.entries(perList).map(([k, n]) => <span key={k} className="chip">{k}: {n}</span>)}
            {invalid > 0 && <span className="chip danger"><AlertTriangle size={11} /> {invalid} with errors (will be skipped)</span>}
            {dupes > 0 && <span className="chip warn">{dupes} already exist{skipDuplicates ? ' (will be skipped)' : ''}</span>}
            {preview.ignoredColumns.length > 0 && <span className="xs faint">Ignored columns: {preview.ignoredColumns.join(', ')}</span>}
          </div>
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Row</th><th>Title</th>{hasLists && <th>List</th>}{linked && <th>Trello</th>}<th>Priority</th><th>Assignee</th><th>Deadline</th><th>Est.</th><th>Sub</th><th>Issues</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n} style={r.errors.length ? { background: 'rgba(248,113,113,0.07)' } : undefined}>
                    <td>{r.n}</td>
                    <td>{r.view.title || <span className="faint">(empty)</span>}</td>
                    {hasLists && <td>{r.view.list}</td>}
                    {linked && <td>{r.view.inTrello === false ? 'Chronos only' : 'Yes'}</td>}
                    <td>{r.view.priority}</td>
                    <td>{r.view.assignee || <span className="faint">—</span>}</td>
                    <td>{r.view.deadline || <span className="faint">—</span>}</td>
                    <td>{r.view.estimateHours != null ? `${r.view.estimateHours} h` : <span className="faint">—</span>}</td>
                    <td>{r.view.subtasks || ''}</td>
                    <td className="xs">
                      {r.errors.map((m, i) => <div key={i} style={{ color: 'var(--danger)' }}>{m}</div>)}
                      {r.warnings.map((m, i) => <div key={i} style={{ color: 'var(--warn)' }}>{m}</div>)}
                      {r.duplicate && !r.errors.length && <div style={{ color: 'var(--warn)' }}>Already exists</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
