import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { RefreshCw, ExternalLink, AlertTriangle, ArrowLeft, Plus, CalendarClock, Layers, Pencil, ChevronRight, UserCog, Crown, Users, Search, GitBranch, Flame, FileSpreadsheet, Trash2, LayoutGrid, List as ListIcon, Eye, Check } from 'lucide-react';
import { api } from '../api';
import { useAuth, useConfirm, useTimer, useToast } from '../context';
import { Avatar, Avatars, ChartTip, Empty, ErrorState, Field, Modal, PageSkeleton, PriorityBadge, Progress, ProjectStatusBadge, Ring, Select, StatusBadge, useFetch } from '../ui';
import { TaskFormModal, TimerButton, useOpenTask, useStatusChange, useLive, LiveHM } from '../components';
import { ProjectFormModal } from './Projects';
import ImportTasksModal from '../ImportTasks';
import { prefetchTask, invalidateTaskCache } from '../taskCache';
import { placeTask } from '../taskMove';
import LocalListModal, { StatusColumnModal } from '../LocalListModal';
import { LabelChips } from '../trello';
import { PRIORITY, PROJECT_STATUS, STATUS, ticketLabel, trelloNumber, ago, fmtDate, fmtDateY, fmtHM, hoursOf, isOverdue } from '../format';

const COLUMNS = ['todo', 'in_progress', 'blocked', 'in_review', 'completed'];

function TaskCard({ t, subIds, onOpen, onDragStart, dragging, compact }) {
  const { user, can } = useAuth();
  const { sessionFor } = useTimer();
  const live = useLive();
  const changeStatus = useStatusChange();
  const toast = useToast();
  const subCount = subIds.length;
  const isRunning = sessionFor(t.id)?.state === 'running';
  const over = isOverdue(t);
  const liveKids = live(subIds);
  const tot = { ...t.totals, total: t.totals.total + live([t.id]) + liveKids };
  const used = t.totals.derived ? t.totals.children + liveKids : tot.total; // subtask time only, when the estimate comes from subtasks
  const pct = tot.estimate ? (used / tot.estimate) * 100 : null;
  const done = t.status === 'completed';
  const canToggle = can.track && (can.manage || t.assignee?.id === user.id);
  const toggleDone = async (e) => {
    e.stopPropagation();
    if (!canToggle) { toast.error('Cannot change status', 'Only the assignee or a manager can mark this complete.'); return; }
    await changeStatus(t, done ? 'in_progress' : 'completed');
  };
  return (
    <div className={`tcard ${dragging ? 'dragging' : ''} ${isRunning ? 'running-ring' : ''}`} style={{ '--pc': PRIORITY[t.priority].color }} draggable onDragStart={onDragStart} onClick={onOpen} onMouseEnter={() => prefetchTask(t.id)} onFocus={() => prefetchTask(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      {compact
        ? <LabelChips labels={t.labels} />
        : <><div className="row between"><PriorityBadge priority={t.priority} />{isRunning && <span className="chip danger"><span className="dot pulse" style={{ width: 6, height: 6 }} /> tracking</span>}</div><LabelChips labels={t.labels} /></>}
      <div className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0 10px' }}>
        <button className={`check card-check ${done ? 'on' : ''}`} onClick={toggleDone} aria-label={done ? 'Mark as not complete' : 'Mark as complete'} title={done ? 'Mark as not complete' : 'Mark as complete'}>
          <Check size={12} strokeWidth={3} />
        </button>
        <h4 style={{ margin: 0, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>{t.ticketNumber && <span className="ticket">{ticketLabel(t)}</span>}{trelloNumber(t) != null && <span className="ticket" style={{ color: '#0079bf' }} title="Card number in Trello">Trello #{trelloNumber(t)}</span>}{t.title}</h4>
      </div>
      {pct != null && (
        <div style={{ marginBottom: 10 }}>
          <div className="row between xs faint" style={{ marginBottom: 4 }}><span>{fmtHM(used)} / {fmtHM(tot.estimate)}</span><span style={{ color: pct > 100 ? 'var(--danger)' : undefined }}>{Math.round(pct)}%</span></div>
          <Progress value={pct} over={pct > 100} thin />
        </div>
      )}
      <div className="meta">
        {compact && isRunning && <span className="chip danger"><span className="dot pulse" style={{ width: 6, height: 6 }} /> tracking</span>}
        {t.chronosOnly && <span className="chip" title="Exists only in Chronos. Not in Trello.">Chronos only</span>}
        {t.deadline && <span className={`chip ${over ? 'danger' : ''}`}><CalendarClock size={11} /> {fmtDate(t.deadline)}</span>}
        {subCount > 0 && <span className="chip"><GitBranch size={11} /> {tot.subtaskDone}/{tot.subtaskCount}</span>}
        {pct == null && tot.total > 0 && <span className="chip">{fmtHM(tot.total)}</span>}
        {compact && !t.parent && <PriorityBadge priority={t.priority} />}
        <span className="right row" style={{ gap: 6 }}>{t.parent ? ((!compact || t.assignee) && <Avatar user={t.assignee} size={24} />) : ((t.assignee || t.collaborators?.length > 0) && <Avatars users={[t.assignee, ...(t.collaborators || [])].filter(Boolean)} max={3} size={24} />)}<TimerButton task={t} /></span>
      </div>
    </div>
  );
}

function Board({ tasks, subsOf, canCreate, onAdd, onOpen, reload, lists, onImport, localLists = [], listTools, statusTools, statusLabels = {}, hiddenStatuses = [], patchTask, canOverride }) {
  const changeStatus = useStatusChange();
  const toast = useToast();
  const moveSeq = useRef({}); // per card: only the LATEST move may confirm or undo itself (quick successive drags)
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const linked = !!lists?.length; // Trello-linked project
  // Custom lists (added by the owner) are extra columns on every project.
  const customCols = localLists.map((l) => ({ key: l.id, label: l.name, color: 'var(--text-3)', match: (t) => t.localStage === l.id, stageId: l.id, local: true }));
  // Trello-linked project: the columns ARE the Trello lists (+ custom lists). Otherwise: our statuses (+ custom lists).
  const columns = linked
    ? [...lists.map((l) => ({ key: l.id, label: l.name, color: '#0079bf', match: (t) => (t.localStage || t.trello?.idList) === l.id, stageId: l.id })),
       ...customCols,
       ...(tasks.some((t) => !t.trello?.idList && !t.localStage) ? [{ key: '__local', label: 'Not on Trello', color: 'var(--text-3)', match: (t) => !t.trello?.idList && !t.localStage }] : [])]
    : [...(showCancelled ? [...COLUMNS, 'cancelled'] : COLUMNS)
        // a hidden column stays hidden only while it is empty (a card given that status elsewhere brings it back)
        .filter((s) => !hiddenStatuses.includes(s) || tasks.some((t) => !t.localStage && t.status === s))
        .map((s) => ({ key: s, label: statusLabels[s] || STATUS[s].label, color: STATUS[s].color, match: (t) => !t.localStage && t.status === s, status: s })), ...customCols];
  // Dropping a card moves it on screen AT ONCE; the server is told in the background. If the server refuses, the card goes back and an
  // error is shown. (Before, the card waited for the server and then for a full reload of the board, which felt slow.)
  const drop = (col) => {
    setOver(null);
    const t = tasks.find((x) => x.id === drag);
    setDrag(null);
    if (!t) return;
    const n = (moveSeq.current[t.id] = (moveSeq.current[t.id] || 0) + 1);
    const latest = () => moveSeq.current[t.id] === n;
    if (linked) {
      if (!col.stageId) return;
      if ((t.localStage || t.trello?.idList) === col.stageId) return; // already there
      patchTask(t.id, (x) => placeTask(x, { id: col.stageId, name: col.label, local: !!col.local }));
      api.patch(`/tasks/${t.id}`, { stageId: col.stageId })
        .then((r) => { invalidateTaskCache(); if (latest()) patchTask(t.id, (x) => ({ ...x, ...r })); })
        .catch((e) => { if (latest()) patchTask(t.id, () => t); toast.error('Could not move the card', e.message); });
    } else if (col.local) {
      // custom column on a project without Trello: only the column changes (status is kept)
      if (t.localStage === col.stageId) return;
      patchTask(t.id, (x) => ({ ...x, localStage: col.stageId, stage: col.label }));
      api.patch(`/tasks/${t.id}`, { stageId: col.stageId })
        .then((r) => { invalidateTaskCache(); if (latest()) patchTask(t.id, (x) => ({ ...x, ...r })); })
        .catch((e) => { if (latest()) patchTask(t.id, () => t); toast.error('Could not move the card', e.message); });
    } else if (t.status !== col.status || t.localStage) {
      if (col.status === 'completed' && !canOverride) {
        // the server refuses this for everyone except the owner / project manager, so don't move the card and bounce it back
        const open = subsOf(t.id).filter((s) => s.required && !['completed', 'cancelled'].includes(s.status)).length;
        if (open) { toast.error('Cannot complete yet', `${open} required subtask${open > 1 ? 's are' : ' is'} still open. Finish ${open > 1 ? 'them' : 'it'} first, or ask the project manager to override.`); return; }
      }
      patchTask(t.id, (x) => ({ ...x, status: col.status, localStage: null, stage: x.localStage ? '' : x.stage }));
      // useStatusChange handles the "complete with open subtasks?" override question; it returns the saved task, or null if refused / cancelled
      changeStatus(t, col.status, t.localStage ? { stageId: null } : {}).then((r) => { if (latest()) patchTask(t.id, (x) => (r ? { ...x, ...r } : t)); if (!r && latest()) toast.error('Card moved back', 'The change was not saved.'); });
    }
  };
  return (
    <div className="board-wrap">
      {!linked && <div className="board-tools"><button className="btn sm" onClick={() => setShowCancelled(!showCancelled)}><Eye size={14} /> {showCancelled ? 'Hide' : 'Show'} cancelled</button>{statusTools && hiddenStatuses.length > 0 && <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => statusTools.restore()}><Eye size={14} /> Show hidden columns ({hiddenStatuses.length})</button>}</div>}
      <div className="board trello">
        {columns.map((col, idx) => {
          const items = tasks.filter(col.match);
          return (
            <div key={col.key} className={`col ${over === col.key ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(col.key); }} onDragLeave={() => setOver((o) => (o === col.key ? null : o))} onDrop={() => drop(col)}>
              <div className="col-head">{col.status && <span className="dot" style={{ '--c': col.color }} />}{col.label}<span className="n">{items.length}</span>{col.local && <span className="chip" style={{ fontSize: 10, padding: '1px 6px', marginLeft: 6 }} title="Exists only in Chronos. Trello does not see this list.">Chronos only</span>}{listTools && col.local && listTools.canEdit(localLists.find((l) => l.id === col.stageId)) && <><button className="btn ghost icon sm" style={{ marginLeft: 2 }} title="Rename list" aria-label="Rename list" onClick={() => listTools.rename(localLists.find((l) => l.id === col.stageId))}><Pencil size={13} /></button><button className="btn ghost icon sm" title="Delete list" aria-label="Delete list" onClick={() => listTools.remove(localLists.find((l) => l.id === col.stageId))}><Trash2 size={13} /></button></>}{statusTools && col.status && <><button className="btn ghost icon sm" style={{ marginLeft: 2 }} title="Rename column" aria-label="Rename column" onClick={() => statusTools.rename(col.status, STATUS[col.status].label)}><Pencil size={13} /></button><button className="btn ghost icon sm" title={items.length ? 'Move the cards out first to hide this column' : 'Hide this column'} aria-label="Hide column" disabled={items.length > 0} style={items.length ? { opacity: 0.35 } : undefined} onClick={() => statusTools.hide(col.status, col.label)}><Trash2 size={13} /></button></>}{onImport && (col.stageId || col.status) && <button className="btn ghost icon sm" style={{ marginLeft: 4 }} title="Import tasks from Excel" aria-label="Import tasks from Excel" onClick={() => onImport(col.status ? { status: col.status, name: col.label } : { id: col.stageId, name: col.label })}><FileSpreadsheet size={14} /></button>}</div>
              {items.map((t) => <TaskCard key={t.id} t={t} subIds={subsOf(t.id).map((s) => s.id)} dragging={drag === t.id} compact onOpen={() => onOpen(t.id)} onDragStart={() => setDrag(t.id)} />)}
              {canCreate && (linked ? !!col.stageId : true) && <button className="add-card" onClick={() => onAdd(col.stageId, col.status)}><Plus size={13} style={{ verticalAlign: -2 }} /> Add a card</button>}
              {items.length === 0 && !(canCreate && (linked ? !!col.stageId : true)) && <div className="xs faint" style={{ textAlign: 'center', padding: '16px 0' }}>Drop tasks here</div>}
            </div>
          );
        })}
        {listTools && <button className="add-list" onClick={() => listTools.add()} title="Add a column to this board"><Plus size={14} style={{ verticalAlign: -2 }} /> Add another list</button>}
      </div>
    </div>
  );
}

function ListView({ tasks, subsOf, onOpen }) {
  const [openRows, setOpenRows] = useState({});
  if (!tasks.length) return <div className="card"><Empty icon={Layers} title="No tasks match">Adjust your filters or add a task.</Empty></div>;
  return (
    <div className="card" style={{ padding: 8 }}>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th><th>Time · est.</th><th /></tr></thead>
        <tbody>
          {tasks.map((t) => {
            const subs = subsOf(t.id);
            const ex = openRows[t.id];
            const rows = [t, ...(ex ? subs : [])];
            return rows.map((r) => (
              <tr key={r.id} className="click" onMouseEnter={() => prefetchTask(r.id)} onClick={() => onOpen(r.id)} style={r.parent ? { background: 'var(--surface)' } : undefined}>
                <td style={{ paddingLeft: r.parent ? 44 : 14 }}>
                  <div className="row">
                    {!r.parent && subs.length > 0 ? <button className="btn ghost icon sm" onClick={(e) => { e.stopPropagation(); setOpenRows({ ...openRows, [t.id]: !ex }); }} aria-label="Toggle subtasks"><ChevronRight size={15} style={{ transform: ex ? 'rotate(90deg)' : 'none', transition: '.2s' }} /></button> : !r.parent && <span style={{ width: 28 }} />}
                    <div>{r.ticketNumber && <span className="ticket">{ticketLabel(r)}</span>}{trelloNumber(r) != null && <span className="ticket" style={{ color: '#0079bf' }} title="Card number in Trello">Trello #{trelloNumber(r)}</span>}<b style={{ fontWeight: r.parent ? 500 : 650 }}>{r.title}</b>{!r.parent && subs.length > 0 && <div className="xs faint">{r.totals.subtaskDone}/{r.totals.subtaskCount} subtasks</div>}</div>
                  </div>
                </td>
                <td><div className="row"><Avatar user={r.assignee} size={24} /><span className="small">{r.assignee?.name.split(' ')[0] || <span className="faint">Unassigned</span>}</span></div></td>
                <td><StatusBadge status={r.status} /></td>
                <td><PriorityBadge priority={r.priority} /></td>
                <td>{r.deadline ? <span className={`chip ${isOverdue(r) ? 'danger' : ''}`}>{fmtDate(r.deadline)}</span> : <span className="faint">—</span>}</td>
                <td className="tnum small"><LiveHM base={r.totals.total} ids={[r.id, ...(r.parent ? [] : subs.map((x) => x.id))]} />{r.totals.estimate != null && <span className="faint"> / {fmtHM(r.totals.estimate)}</span>}</td>
                <td><TimerButton task={r} /></td>
              </tr>
            ));
          })}
        </tbody>
      </table></div>
    </div>
  );
}

/** A team member's details: their role, time and open work in this project. Opens from the Team tab. */
function MemberModal({ m, project, tasks, onOpen, onClose }) {
  const mine = tasks.filter((t) => !t.parent && (t.assignee?.id === m.id || t.collaborators?.some((c) => c.id === m.id)));
  const subs = tasks.filter((t) => t.parent && t.assignee?.id === m.id);
  const openMine = mine.filter((t) => !['completed', 'cancelled'].includes(t.status));
  const row = (t) => (
    <button key={t.id} type="button" className="task-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => onOpen(t.parent || t.id)}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontWeight: 600 }}>{t.ticketCode ? <span className="ticket">{t.ticketCode}</span> : t.ticketNumber ? <span className="ticket">{ticketLabel(t)}</span> : null}{t.title}</div>
        <div className="xs faint">{t.deadline ? `due ${fmtDate(t.deadline)}` : 'no deadline'}</div>
      </div>
      <StatusBadge status={t.status} />
    </button>
  );
  return (
    <Modal title="Team member" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar user={m} size={56} />
          <div className="grow">
            <b style={{ fontSize: 18 }}>{m.name}</b>
            <div className="small muted">{m.title || '—'}</div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              <span className="chip">{m.role === 'owner' ? 'Owner' : m.role === 'manager' ? 'Project manager' : m.role === 'viewer' ? 'Read-only' : 'Employee'}</span>
              {project.manager.id === m.id && <span className="chip"><Crown size={11} /> Manager of this project</span>}
              {project.lead?.id === m.id && <span className="chip warn"><Crown size={11} /> Lead</span>}
            </div>
          </div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {[
            ['Email', m.email ? <a href={`mailto:${m.email}`}>{m.email}</a> : '—'],
            ['Job title', m.title || '—'],
            ['Status', m.active === false ? 'Deactivated' : 'Active'],
            ['Member since', m.createdAt ? fmtDateY(m.createdAt) : '—'],
          ].map(([k, v]) => (
            <div key={k} className="row between small" style={{ gap: 12 }}><span className="faint">{k}</span><b style={{ fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</b></div>
          ))}
        </div>
        <div className="grid g2" style={{ gap: 10 }}>
          <div className="tile"><small>Tracked here</small><b className="tnum" style={{ fontSize: 17 }}>{fmtHM(m.secs)}</b></div>
          <div className="tile"><small>Open items</small><b style={{ fontSize: 17 }}>{m.open}</b></div>
        </div>
        <div>
          <div className="small bold" style={{ marginBottom: 6 }}>Tasks <span className="faint">{openMine.length} open · {mine.length} in total</span></div>
          {mine.length === 0 ? <div className="faint small">No tasks you can see are assigned to {m.name.split(' ')[0]}.</div> : <div className="stack" style={{ gap: 2 }}>{mine.slice(0, 12).map(row)}</div>}
        </div>
        {subs.length > 0 && (
          <div>
            <div className="small bold" style={{ marginBottom: 6 }}>Subtasks <span className="faint">{subs.length}</span></div>
            <div className="stack" style={{ gap: 2 }}>{subs.slice(0, 12).map(row)}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function TeamModal({ project, onClose, onSaved }) {
  const toast = useToast();
  const { data: users } = useFetch(() => api.get('/users'), []);
  const [sel, setSel] = useState(project.members.map((m) => m.id));
  const [lead, setLead] = useState(project.lead?.id || '');
  const [busy, setBusy] = useState(false);
  const staff = (users || []).filter((u) => u.role !== 'viewer' && u.active);
  const viewers = (users || []).filter((u) => u.role === 'viewer' && u.active);
  const save = async () => {
    setBusy(true);
    try { onSaved(await api.put(`/projects/${project.id}/members`, { members: sel, lead: lead || null })); toast.success('Team updated'); onClose(); } catch (e) { toast.error('Could not update team', e.message); } finally { setBusy(false); }
  };
  const toggle = (id) => { if (id === project.manager.id) return; setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); if (lead === id) setLead(''); };
  return (
    <Modal title="Manage project team" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>Save team</button></>}>
      <p className="small muted" style={{ marginBottom: 12 }}>Only team members can be assigned work. Removing someone keeps all of their past tasks, time entries and comments.</p>
      <div className="stack" style={{ gap: 6 }}>
        {[...staff, ...viewers].map((u) => {
          const on = sel.includes(u.id);
          return (
            <div key={u.id} className="task-row" onClick={() => toggle(u.id)} style={{ opacity: u.id === project.manager.id ? 0.7 : 1 }}>
              <span className={`check ${on ? 'on' : ''}`}>{on && '✓'}</span>
              <Avatar user={u} size={32} />
              <div className="grow"><b>{u.name}</b><div className="xs faint">{u.title || u.role}{u.id === project.manager.id && ' · project manager'}{u.role === 'viewer' && ' · read-only'}</div></div>
              {on && u.role !== 'viewer' && <button className={`btn sm ${lead === u.id ? 'primary' : ''}`} onClick={(e) => { e.stopPropagation(); setLead(lead === u.id ? '' : u.id); }}><Crown size={13} /> {lead === u.id ? 'Lead' : 'Make lead'}</button>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export default function ProjectDetail({ id: idProp, embedded = false, syncTick = 0 }) {
  const params = useParams();
  const id = idProp || params.id;
  const shell = embedded ? 'project-embedded' : 'page'; // embedded: shown under the project tabs on the Projects page
  const { user, can } = useAuth();
  const toast = useToast();
  const open = useOpenTask();
  const { version } = useTimer();
  const proj = useFetch(() => api.get(`/projects/${id}`), [id, version]);
  const tasksQ = useFetch(() => api.get(`/tasks?project=${id}`), [id, version]);
  const [tab, setTab] = useState('board');
  const [edit, setEdit] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [member, setMember] = useState(null); // the team member whose details are open
  const [newTask, setNewTask] = useState(false); // false | { stageId? }
  const [importOpen, setImportOpen] = useState(false);
  const [statusModal, setStatusModal] = useState(null); // { status, defaultName } rename a status column
  const [listModal, setListModal] = useState(false); // false | { list? }  (Chronos-only list add / rename)
  const confirm = useConfirm();
  const [syncing, setSyncing] = useState(false);
  const [f, setF] = useState({ q: '', mine: false, priority: '', assignee: '' });
  const linkedBoard = proj.data?.trello?.boardId;
  // the Projects page owns the "Sync now" button; reload this project when it finishes a sync
  useEffect(() => { if (syncTick) { proj.reload(); tasksQ.reload(); } }, [syncTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Trello-linked project: pull changes made in Trello now, then about once a minute while this page is open and visible.
  useEffect(() => {
    if (!linkedBoard) return undefined;
    let alive = true;
    const run = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await api.post(`/trello/projects/${id}/sync`, { auto: true });
        const x = r.result || {};
        if (alive && !x.skipped) { proj.reload(); if (x.created || x.updated || x.subtasks || x.removed) tasksQ.reload(); }
      } catch { /* shown through the sync status chip */ }
    };
    run();
    const i = setInterval(run, 60000);
    return () => { alive = false; clearInterval(i); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedBoard, id]);

  const p = proj.data;
  const all = tasksQ.data || [];
  const top = useMemo(() => all.filter((t) => !t.parent), [all]);
  const subsOf = (tid) => all.filter((t) => t.parent === tid);
  const visible = useMemo(() => top.filter((t) => {
    const hay = [t.title, ticketLabel(t), ...subsOf(t.id).flatMap((s) => [s.title, ticketLabel(s)])].join(' ').toLowerCase();
    return (!f.q || hay.includes(f.q.toLowerCase())) && (!f.priority || t.priority === f.priority)
      && (!f.assignee || t.assignee?.id === f.assignee) && (!f.mine || t.assignee?.id === user.id || t.collaborators.some((c) => c.id === user.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [top, all, f, user.id]);

  if (proj.error && !p) return <div className={shell}>{!embedded && <Link to="/projects" className="btn ghost sm"><ArrowLeft size={15} /> Projects</Link>}<div style={{ marginTop: 16 }}><ErrorState error={proj.error} /></div></div>;
  if (!p) return <div className={shell}><PageSkeleton /></div>;

  const isMgr = can.owner || p.manager.id === user.id;
  // Custom board lists: the owner, the project manager and every team member of the project can add one (not read-only viewers).
  const canAddList = user.role !== 'viewer' && (isMgr || p.members.some((m) => m.id === user.id)) && !['archived', 'completed'].includes(p.status);
  // ...and rename or delete them (a list with cards in it can never be deleted)
  const canEditList = (l) => !!l && canAddList;
  const canAssignOthers = isMgr || p.lead?.id === user.id;
  const isTeamMember = can.track && p.members.some((m) => m.id === user.id);
  const canCreate = canAssignOthers || isTeamMember; // team members can add tasks for themselves
  // Team members see only their own work, so their numbers are computed from the tasks they can see.
  const scoped = !(isMgr || p.lead?.id === user.id || user.role === 'viewer');
  const isMine = (t) => t.assignee?.id === user.id || t.collaborators.some((c) => c.id === user.id);
  const myTop = top.filter(isMine);
  const st = scoped ? {
    tasks: myTop.length, done: myTop.filter((t) => t.status === 'completed').length,
    actual: all.filter(isMine).reduce((s, t) => s + t.totals.direct, 0),
    estimate: myTop.reduce((s, t) => s + (t.totals.estimate || 0), 0),
    overdue: all.filter((t) => isMine(t) && isOverdue(t)).length,
  } : p.stats;
  const pct = st.tasks ? (st.done / st.tasks) * 100 : 0;
  const ratio = st.estimate ? (st.actual / st.estimate) * 100 : null;
  const late = p.targetDate && new Date(p.targetDate) < new Date() && !['completed', 'archived'].includes(p.status);

  const removeLocalList = async (l) => {
    if (!(await confirm({ title: `Delete the list “${l.name}”?`, message: 'The list only exists in Chronos, so Trello is not affected. A list that still has tasks cannot be deleted.', danger: true, confirmLabel: 'Delete list' }))) return;
    try { await api.del(`/projects/${p.id}/local-lists/${l.id}`); proj.reload(); toast.success('List deleted'); } catch (e) { toast.error('Could not delete the list', e.message); }
  };

  const hideStatus = async (status, label) => {
    if (!(await confirm({ title: `Hide the “${label}” column?`, message: 'Nothing is deleted. The column is only hidden while it is empty, and you can bring it back with “Show hidden columns”.', confirmLabel: 'Hide column' }))) return;
    try { const np = await api.patch(`/projects/${p.id}/status-columns/${status}`, { hidden: true }); proj.setData((d) => ({ ...d, ...np })); toast.success('Column hidden'); } catch (e) { toast.error('Could not hide the column', e.message); }
  };
  const restoreStatuses = async () => {
    try { const np = await api.post(`/projects/${p.id}/status-columns/restore`, {}); proj.setData((d) => ({ ...d, ...np })); toast.success('Columns shown again'); } catch (e) { toast.error('Could not show the columns', e.message); }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.post(`/trello/projects/${id}/sync`, {});
      const x = r.result || {};
      toast.success('Synced with Trello', x.skipped ? 'Another sync is already running.' : `${x.created || 0} new, ${x.updated || 0} updated, ${x.subtasks || 0} checklist changes.`);
      proj.reload(); tasksQ.reload();
    } catch (e) { toast.error('Sync failed', e.message); } finally { setSyncing(false); }
  };

  const setStatus = async (status) => {
    try { await api.patch(`/projects/${p.id}`, { status }); toast.success(`Project marked ${PROJECT_STATUS[status].label}`); proj.reload(); } catch (e) { toast.error('Could not update', e.message); }
  };

  const memberRows = p.members.map((m) => ({ ...m, secs: p.timeByUser[m.id] || 0, open: p.openByUser[m.id] || 0 })).sort((a, b) => b.secs - a.secs);
  const maxSecs = Math.max(1, ...memberRows.map((m) => m.secs));
  const variance = top.filter((t) => t.totals.estimate).map((t) => ({ t, diff: t.totals.total - t.totals.estimate })).sort((a, b) => b.diff - a.diff);

  return (
    <div className={shell}>
      {!embedded && <Link to="/projects" className="btn ghost sm" style={{ marginBottom: 6 }}><ArrowLeft size={15} /> Projects</Link>}
      {!embedded && <div className="page-head" style={{ marginTop: 0 }}>
        {!embedded && <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <Ring value={pct} size={64} stroke={6} color={p.color} />
          <div>
            <div className="row wrap"><h1 style={{ fontSize: 26 }}>{p.name}</h1><ProjectStatusBadge status={p.status} />{late && <span className="chip danger"><Flame size={11} /> Past target date</span>}</div>
            <p style={{ maxWidth: 640 }}>{p.description || 'No description'}</p>
            <div className="row wrap small muted" style={{ marginTop: 8, gap: 14 }}>
              <span className="row" style={{ gap: 6 }}><Avatar user={p.manager} size={22} /> {p.manager.name}</span>
              {(p.startDate || p.targetDate) && <span className="row" style={{ gap: 5 }}><CalendarClock size={14} /> {fmtDate(p.startDate)} → {fmtDateY(p.targetDate)}</span>}
              <Avatars users={p.members} max={6} size={26} />
            </div>
            {p.trello && (
              <div className="row wrap small" style={{ marginTop: 8, gap: 10 }}>
                <a className="chip sync-chip" href={p.trello.url} target="_blank" rel="noreferrer" title="Open the Trello board" style={{ color: '#4c9aff' }}><ExternalLink size={11} /> Trello · {p.trello.name}</a>
                <span className="faint xs">{p.trello.lastSyncAt ? `Synced ${ago(p.trello.lastSyncAt)}` : 'Not synced yet'} · refreshes every minute</span>
                {isMgr && <button className="btn sm" onClick={syncNow} disabled={syncing}><RefreshCw size={13} className={syncing ? 'spin' : ''} /> Sync now</button>}
                {p.trello.syncError && <span className="chip warn" title={p.trello.syncError}><AlertTriangle size={11} /> {p.trello.syncError.slice(0, 70)}</span>}
              </div>
            )}
          </div>
        </div>}
        <div className="row wrap">
          {isMgr && <Select className="sm" style={{ width: 140 }} value={p.status} onChange={(e) => setStatus(e.target.value)} aria-label="Project status">{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}
          {isMgr && <button className="btn" onClick={() => setEdit(true)}><Pencil size={15} /> Edit</button>}
          {user.role === 'owner' && !['archived', 'completed'].includes(p.status) && <button className="btn" onClick={() => setImportOpen({})}><FileSpreadsheet size={16} /> Import</button>}
          {canCreate && p.status !== 'archived' && <button className="btn primary" onClick={() => setNewTask({})}><Plus size={16} /> New task</button>}
        </div>
      </div>}

      {scoped && <div className="callout info" style={{ marginBottom: 16 }}><Eye size={17} style={{ flex: 'none' }} /><span>You’re seeing <b>your own tasks</b> in this project. Managers see everyone’s work. Use <b>Add my task</b> to add something you’re working on, and post updates from each task.</span></div>}
      {!embedded && <div className="grid g4" style={{ marginBottom: 22 }}>
        <div className="tile"><small>{scoped ? 'My tasks done' : 'Tasks done'}</small><b>{st.done}<span className="faint" style={{ fontSize: 14 }}> / {st.tasks}</span></b></div>
        <div className="tile"><small>Tracked effort</small><b className="tnum">{fmtHM(st.actual)}</b></div>
        <div className="tile"><small>Estimated</small><b className="tnum">{st.estimate ? fmtHM(st.estimate) : '—'}</b>{ratio != null && <div style={{ marginTop: 8 }}><Progress value={ratio} over={ratio > 100} thin /></div>}</div>
        <div className="tile"><small>Overdue</small><b style={{ color: st.overdue ? 'var(--danger)' : undefined }}>{st.overdue}</b></div>
      </div>}

      {(() => {
        const tabsEl = (
        <div className="tabs">
          <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}><LayoutGrid size={14} /> Board</button>
          <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}><ListIcon size={14} /> List</button>
          <button className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}><Users size={14} /> Team <span className="n">{p.members.length}</span></button>
        </div>
        );
        const filtersEl = (tab === 'board' || tab === 'list') && (
          <div className="row wrap">
            <div className="search" style={{ width: 210 }}><Search size={15} /><input className="input sm" style={{ paddingLeft: 36 }} placeholder="Search…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
            <Select className="sm" style={{ width: 130 }} value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} aria-label="Assignee"><option value="">Everyone</option>{p.members.map((m) => <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>)}</Select>
            <Select className="sm" style={{ width: 120 }} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Priority"><option value="">Any priority</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          </div>
        );
        const content = (
<>{tasksQ.loading && !tasksQ.data ? <PageSkeleton /> : (
        <>
          {tab === 'board' && <Board tasks={visible} subsOf={subsOf} lists={p.trello?.lists} localLists={p.localLists || []} listTools={canAddList ? { canEdit: canEditList, add: (o) => setListModal(o || {}), rename: (l) => setListModal({ list: l }), remove: removeLocalList } : undefined} canCreate={canCreate && p.status !== 'archived'} onAdd={(stageId, status) => setNewTask({ stageId, status })} onImport={user.role === 'owner' && !['archived', 'completed'].includes(p.status) ? (x) => setImportOpen(x.status ? { status: x.status } : { list: x }) : undefined} onOpen={open} reload={() => { tasksQ.reload(); proj.reload(); }} statusLabels={p.statusLabels || {}} hiddenStatuses={p.hiddenStatuses || []} statusTools={canAddList && !p.trello?.boardId ? { rename: (status, defaultName) => setStatusModal({ status, defaultName }), hide: hideStatus, restore: restoreStatuses } : undefined} canOverride={isMgr} patchTask={(id, fn) => tasksQ.setData((list) => (list || []).map((x) => (x.id === id ? fn(x) : x)))} />}
          {tab === 'list' && <ListView tasks={visible} subsOf={subsOf} onOpen={open} />}

          {tab === 'team' && (
            <div className="stack">
              {isMgr && <div className="row between"><span className="small muted">Team members can be assigned tasks and subtasks in this project.</span><button className="btn" onClick={() => setTeamOpen(true)}><UserCog size={16} /> Manage team</button></div>}
              <div className="grid g3">
                {memberRows.map((m) => (
                  <div key={m.id} className="card hover" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setMember(m)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setMember(m)} title="Open details">
                    <div className="row"><Avatar user={m} size={44} /><div className="grow"><b>{m.name}</b><div className="xs faint">{m.title || m.role}</div></div>
                      {p.manager.id === m.id && <span className="chip"><Crown size={11} /> Manager</span>}{p.lead?.id === m.id && <span className="chip warn"><Crown size={11} /> Lead</span>}{m.role === 'viewer' && <span className="chip">Read-only</span>}</div>
                    <div className="grid g2" style={{ gap: 10, marginTop: 16 }}><div className="tile"><small>Tracked here</small><b className="tnum" style={{ fontSize: 17 }}>{fmtHM(m.secs)}</b></div><div className="tile"><small>Open items</small><b style={{ fontSize: 17 }}>{m.open}</b></div></div>
                    <div className="progress thin" style={{ marginTop: 14 }}><span style={{ width: `${(m.secs / maxSecs) * 100}%`, background: m.color }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'insights' && (
            <div className="grid g2">
              <div className="card">
                <div className="card-title"><h3>Time by team member</h3><small>hours, all time</small></div>
                <div style={{ height: 260 }}><ResponsiveContainer><BarChart data={memberRows.filter((m) => m.secs).map((m) => ({ name: m.name.split(' ')[0], hours: hoursOf(m.secs), fill: m.color }))} margin={{ left: -20 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="name" tick={{ fill: 'var(--text-3)', fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: 'var(--text-3)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={(v) => `${v} h`} />} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="hours" name="Tracked" radius={[8, 8, 0, 0]}>{memberRows.filter((m) => m.secs).map((m) => <Cell key={m.id} fill={m.color} />)}</Bar>
                </BarChart></ResponsiveContainer></div>
              </div>
              <div className="card">
                <div className="card-title"><h3>Estimate vs actual by task</h3><small>largest overruns first</small></div>
                {variance.length === 0 ? <div className="faint small">No tasks have estimates yet.</div> : (
                  <div className="stack" style={{ gap: 14 }}>
                    {variance.slice(0, 7).map(({ t, diff }) => {
                      const r = (t.totals.total / t.totals.estimate) * 100;
                      return (
                        <div key={t.id} style={{ cursor: 'pointer' }} onClick={() => open(t.id)}>
                          <div className="row between small" style={{ marginBottom: 5 }}><b className="ellipsis">{t.title}</b>
                            <span style={{ color: diff > 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700, whiteSpace: 'nowrap' }}>{diff > 0 ? '+' : '−'}{fmtHM(Math.abs(diff))}</span></div>
                          <Progress value={r} over={r > 100} thin />
                          <div className="xs faint" style={{ marginTop: 3 }}>{fmtHM(t.totals.total)} of {fmtHM(t.totals.estimate)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}</>
        );
        // Trello look: title + filters on top, the view tabs as a floating dock at the bottom
        return (
          <div className="trello-shell">
            <div className="t-top"><b className="t-title">{p.name}</b><span className="grow" />{filtersEl}
              {embedded && (
                <>
                  <span className="t-sep" />
                  {isMgr && <Select className="sm" value={p.status} onChange={(e) => setStatus(e.target.value)} aria-label="Project status">{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}
                  {isMgr && <button className="btn sm icon" onClick={() => setEdit(true)} aria-label="Edit project" title="Edit project"><Pencil size={14} /></button>}
                  {canAddList && <button className="btn sm" onClick={() => setListModal({})} title="Add a list: in Chronos + Trello, or Chronos only"><Plus size={14} /> Add list</button>}
                </>
              )}
            </div>
            <div className={`t-body ${tab === 'board' ? '' : tab === 'list' ? 't-list' : 't-panel'}`}>{content}</div>
            <div className="t-dock">{tabsEl}</div>
          </div>
        );
      })()}

      {edit && <ProjectFormModal project={p} onClose={() => setEdit(false)} onSaved={() => proj.reload()} />}
      {member && <MemberModal m={member} project={p} tasks={all} onOpen={(tid) => { setMember(null); open(tid); }} onClose={() => setMember(null)} />}
      {teamOpen && <TeamModal project={p} onClose={() => setTeamOpen(false)} onSaved={() => proj.reload()} />}
      {statusModal && <StatusColumnModal project={p} status={statusModal.status} defaultName={statusModal.defaultName} onClose={() => setStatusModal(null)} onSaved={(np) => proj.setData((d) => ({ ...d, ...np }))} />}
      {listModal && <LocalListModal project={p} list={listModal.list} kind={listModal.kind} canTrello={isMgr} onClose={() => setListModal(false)} onSaved={() => proj.reload()} />}
      {importOpen && <ImportTasksModal project={p} defaultListId={importOpen.list?.id} defaultStatus={importOpen.status} onClose={() => setImportOpen(false)} onDone={() => { tasksQ.reload(); proj.reload(); }} />}
      {newTask && <TaskFormModal project={p} trello={p.trello} localLists={p.localLists || []} initialStage={newTask.stageId} initialStatus={newTask.status} selfOnly={!canAssignOthers} me={user} members={p.members.filter((m) => m.role !== 'viewer')} onClose={() => setNewTask(false)} onSaved={(t) => { tasksQ.reload(); proj.reload(); open(t.id); }} />}
    </div>
  );
}
