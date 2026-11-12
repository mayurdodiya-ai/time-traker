import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, FolderKanban, Download, RefreshCw, Search, ChevronDown } from 'lucide-react';
import ProjectDetail from './ProjectDetail';
import { TrelloImportModal } from '../trello';
import { api } from '../api';
import { useAuth, useTimer, useToast } from '../context';
import { ErrorState, Empty, Field, Modal, Select, Skeleton, useFetch } from '../ui';
import { PROJECT_STATUS, toInputDate } from '../format';

export const PALETTE = ['#5468ff', '#8f7bff', '#d874c6', '#e5484d', '#e08a2b', '#3fb950', '#1e9b7a', '#0a84ff'];

export function ProjectFormModal({ project, onClose, onSaved }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data: users } = useFetch(() => api.get('/users'), []);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: project?.name || '', description: project?.description || '', status: project?.status || 'planning',
    manager: project?.manager?.id || '', startDate: toInputDate(project?.startDate), targetDate: toInputDate(project?.targetDate),
    color: project?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)], members: project?.members?.map((m) => m.id) || [],
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const managers = (users || []).filter((u) => ['owner', 'manager'].includes(u.role) && u.active);
  const staff = (users || []).filter((u) => u.role !== 'viewer' && u.active);

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, description: f.description, status: f.status, startDate: f.startDate || null, targetDate: f.targetDate || null, color: f.color };
      if (can.owner && f.manager) body.manager = f.manager;
      let r;
      if (project) r = await api.patch(`/projects/${project.id}`, body);
      else r = await api.post('/projects', { ...body, members: f.members });
      toast.success(project ? 'Project updated' : 'Project created');
      onSaved(r);
      onClose();
    } catch (e) { toast.error('Could not save project', e.message); } finally { setBusy(false); }
  };

  return (
    <Modal wide title={project ? 'Edit project' : 'New project'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !f.name.trim()}>{busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}</button></>}>
      <div className="form-grid">
        <Field label="Project name" full><input className="input" autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Website Redesign" /></Field>
        <Field label="Description" full><textarea className="textarea" style={{ minHeight: 70 }} value={f.description} onChange={set('description')} placeholder="What is the objective of this project?" /></Field>
        <Field label="Status"><Select value={f.status} onChange={set('status')}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        {can.owner ? (
          <Field label="Project manager"><Select value={f.manager} onChange={set('manager')}><option value="">Me</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        ) : <Field label="Project manager"><div className="input" style={{ opacity: 0.8 }}>{project?.manager?.name || 'You'}</div></Field>}
        <Field label="Start date"><input type="date" className="input" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="Target completion"><input type="date" className="input" value={f.targetDate} onChange={set('targetDate')} /></Field>
        <Field label="Colour" full>
          <div className="row">{PALETTE.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })} style={{ width: 30, height: 30, borderRadius: 10, background: c, outline: f.color === c ? '3px solid var(--text)' : 'none', outlineOffset: 2 }} />)}</div>
        </Field>
        {!project && (
          <Field label="Project team" full hint="Only team members can be assigned work. You can change this later.">
            <div className="row wrap">
              {staff.map((u) => {
                const on = f.members.includes(u.id);
                return <button key={u.id} type="button" className="chip" style={{ padding: '6px 11px', borderColor: on ? 'var(--primary)' : undefined, background: on ? 'rgba(124,124,255,.18)' : undefined, color: on ? 'var(--text)' : undefined }}
                  onClick={() => setF({ ...f, members: on ? f.members.filter((i) => i !== u.id) : [...f.members, u.id] })}>{on ? '✓' : '+'} {u.name}</button>;
              })}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}

const LAST = 'chronos.project';

/** Search box that lists every project; pick one to open it. */
function ProjectPicker({ projects, selected, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef(null);
  const cur = projects.find((p) => p.id === selected);
  const found = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())), [projects, q]);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  const pick = (p) => { onPick(p.id); setOpen(false); setQ(''); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((i) => Math.min(i + 1, found.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && found[hi]) { e.preventDefault(); pick(found[hi]); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); e.currentTarget.blur(); }
  };
  return (
    <div className="ppick" ref={box}>
      <div className="search"><Search size={16} />
        <input className="input" role="combobox" aria-expanded={open} aria-label="Search projects" placeholder={cur ? cur.name : 'Search projects…'} value={q}
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }} onKeyDown={key} />
        <ChevronDown size={16} className="ppick-chev" />
      </div>
      {open && (
        <div className="ppick-list" role="listbox">
          {found.length === 0 ? <div className="faint small" style={{ padding: 14 }}>No project matches “{q}”.</div> : found.map((p, i) => (
            <button key={p.id} role="option" aria-selected={p.id === selected} className={`${i === hi ? 'hi' : ''} ${p.id === selected ? 'on' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(p)}>
              <span className="dot-c" style={{ background: p.color }} /><span className="grow ellipsis">{p.name}</span>
              {p.trello && <span className="chip" style={{ color: '#4c9aff' }}>Trello</span>}
              <span className="xs faint">{p.manager?.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const remembered = () => { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } };

/** Projects as tabs: pick a project and its board opens right below. */
export default function Projects() {
  const { can, user } = useAuth();
  const toast = useToast();
  const { version } = useTimer();
  const { data, error, reload } = useFetch(() => api.get('/projects'), [version]);
  const [picked, setPicked] = useState(remembered);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncTick, setSyncTick] = useState(0);

  const list = useMemo(() => [...(data || [])].sort((x, y) => (x.status === 'archived') - (y.status === 'archived')), [data]);
  const sel = list.find((p) => p.id === picked)?.id || list[0]?.id || '';
  const cur = list.find((p) => p.id === sel);
  const canSync = !!cur?.trello && (can.owner || cur.manager?.id === user.id);
  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.post(`/trello/projects/${sel}/sync`, {});
      const x = r.result || {};
      toast.success('Synced with Trello', x.skipped ? 'Another sync is already running.' : `${x.created || 0} new, ${x.updated || 0} updated, ${x.subtasks || 0} checklist changes.`);
      setSyncTick((n) => n + 1); reload();
    } catch (e) { toast.error('Sync failed', e.message); } finally { setSyncing(false); }
  };
  const choose = (id) => { setPicked(id); try { localStorage.setItem(LAST, id); } catch { /* private mode */ } };

  if (error && !data) return <div className="page"><ErrorState error={error} retry={reload} /></div>;
  return (
    <div className="page wide">
      <div className="page-head" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div><h1>Projects</h1><p>{data ? `${data.length} project${data.length === 1 ? '' : 's'} you have access to` : 'Loading…'}</p></div>
        {data && list.length > 0 && <div style={{ flex: '1 1 260px', minWidth: 220, maxWidth: 520 }}><ProjectPicker projects={list} selected={sel} onPick={choose} /></div>}
        {can.manage && (
          <div className="row">
            <button className="btn" onClick={syncNow} disabled={syncing || !canSync} title={!cur?.trello ? 'This project is not linked to a Trello board' : !canSync ? 'Only the admin or this project’s manager can sync' : cur.trello.syncError || 'Pulls changes from Trello now. It also refreshes by itself every minute.'}><RefreshCw size={16} className={syncing ? 'spin' : ''} /> Sync now</button>
            <button className="btn" onClick={() => setImporting(true)}><Download size={16} /> Import from Trello</button>
            <button className="btn primary" onClick={() => setOpen(true)}><Plus size={17} /> Add internal project</button>
          </div>
        )}
      </div>

      {!data ? <Skeleton h={250} /> : list.length === 0 ? (
        <div className="card"><Empty icon={FolderKanban} title="No projects yet"
          action={can.manage && <button className="btn primary" onClick={() => setOpen(true)}><Plus size={16} /> Add your first internal project</button>}>
          {can.manage ? 'Create a project, build its team, then add tasks.' : 'You haven’t been added to a project yet.'}</Empty></div>
      ) : (
        <>
          <ProjectDetail key={sel} id={sel} embedded syncTick={syncTick} />
        </>
      )}
      {importing && <TrelloImportModal onClose={() => setImporting(false)} onImported={(id) => { reload(); choose(id); }} />}
      {open && <ProjectFormModal onClose={() => setOpen(false)} onSaved={(p) => { reload(); choose(p.id); }} />}
    </div>
  );
}
