import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Plus, Trash2, X, Clock, MessageSquare, History, Send, ChevronRight, Info, PenLine, Pencil, Loader2, ExternalLink, Paperclip, FileText } from 'lucide-react';
import { api } from './api';
import { getCachedTask, setCachedTask } from './taskCache';
import { useAuth, useConfirm, useTimer, useTick, useToast } from './context';
import { Avatar, ApprovalBadge, Badge, Drawer, Empty, Field, Modal, Progress, PriorityBadge, Select, Skeleton, useFetch } from './ui';
import { LabelChips, LabelPicker } from './trello';
import { PeoplePicker, TimerButton, TimeEntryModal, TaskFormModal, DurationInput, useStatusChange, useLive, useForeignLive, LiveHM, CommentBody, TrelloImage } from './components';
import { STATUS, PRIORITY, ticketLabel, fmtHM, fmtClock, fmtDate, fmtDay, ago, toInputDate, isOverdue, estimateUsedUp, dateStr } from './format';
import { Card, CardContent } from '@/components/ui/card';

function StatTile({ label, value, highlight }) {
  return (
    <Card className={`gap-0 border-border py-3 ${highlight ? 'bg-primary/10' : 'bg-card'}`}>
      <CardContent className="px-3.5">
        <small className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</small>
        <b className="tnum mt-0.5 block text-xl font-extrabold tracking-tight text-foreground">{value}</b>
      </CardContent>
    </Card>
  );
}

function EstimateBar({ totals }) {
  const { total, estimate } = totals;
  if (estimate == null) return <div className="small faint row" style={{ gap: 6 }}><Info size={13} /> No estimate set — add one to compare with actual effort.</div>;
  if (estimate === 0) return <div className="small warn" style={{ color: 'var(--warn)' }}>Explicit 0h estimate · {fmtHM(total)} tracked</div>;
  const pct = (total / estimate) * 100;
  const diff = total - estimate;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Progress value={pct} over={pct > 100} />
      <div className="row between small">
        <span className="muted">{Math.round(pct)}% of estimate consumed</span>
        <b style={{ color: diff > 0 ? 'var(--danger)' : 'var(--success)' }}>{diff > 0 ? `${fmtHM(diff)} over estimate` : `${fmtHM(-diff)} remaining`}</b>
      </div>
    </div>
  );
}

function LiveTotal({ task, totals }) {
  const { sessionFor, elapsedOf } = useTimer();
  const s = sessionFor(task.id);
  const now = useTick(s?.state === 'running');
  if (!s) return null;
  return (
    <div className="callout" style={{ alignItems: 'center' }}>
      {s.state === 'running' ? <span className="dot pulse" /> : <span className="dot" style={{ '--c': 'var(--warn)' }} />}
      <div className="grow small"><b>{s.state === 'running' ? 'Timer running' : 'Timer paused'}</b> — not yet saved to history</div>
      <b className="tnum" style={{ fontSize: 18 }}>{fmtClock(elapsedOf(s, now))}</b>
    </div>
  );
}

/** A field that reads as plain text and turns into an input/textarea on click, committing on blur (Enter for
 * single-line) and reverting on Escape. Renders read-only (no click handler) when `disabled`. */
function InlineText({ value, onCommit, disabled, multiline, placeholder, emptyLabel, required, requiredMessage, maxLength, minHeight, className, style, inputStyle, ariaLabel }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [buf, setBuf] = useState(value || '');
  useEffect(() => { if (!editing) setBuf(value || ''); }, [value, editing]);
  const start = () => { if (disabled) return; setBuf(value || ''); setEditing(true); };
  const cancel = () => { setBuf(value || ''); setEditing(false); };
  const commit = () => {
    const v = buf.trim();
    if (required && !v) { toast.error(requiredMessage || 'This field is required'); return; }
    setEditing(false);
    if (v === (value || '').trim()) return;
    onCommit(v);
  };
  if (disabled || !editing) {
    const empty = !value;
    const content = value || emptyLabel;
    return multiline
      ? <div className={`textarea-view ${empty ? 'faint' : ''} ${className || ''}`} style={disabled ? style : { cursor: 'pointer', ...style }} onClick={disabled ? undefined : start} title={disabled ? undefined : 'Click to edit'}>{content}</div>
      : <span className={className} style={disabled ? style : { cursor: 'pointer', ...style }} onClick={disabled ? undefined : start} title={disabled ? undefined : 'Click to edit'}>{empty ? <span className="faint">{content}</span> : content}</span>;
  }
  return multiline
    ? <textarea className="textarea" style={{ minHeight, ...inputStyle }} autoFocus value={buf} placeholder={placeholder} maxLength={maxLength}
        onChange={(e) => setBuf(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }} aria-label={ariaLabel} />
    : <input className="input" style={inputStyle} autoFocus value={buf} placeholder={placeholder} maxLength={maxLength}
        onChange={(e) => setBuf(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } }} aria-label={ariaLabel} />;
}

/** Trello labels: read-only chips that turn into the label picker on click. Toggling labels only changes a local
 * buffer (no network call per click) — a single PATCH fires once, on "Done" or on clicking away, so picking several
 * labels costs one request instead of one per click. Renders read-only (no click handler) when `disabled`. */
function InlineLabels({ value, options, projectId, onCommit, disabled, labels }) {
  const [editing, setEditing] = useState(false);
  const [buf, setBuf] = useState(value);
  const boxRef = useRef(null);
  const start = () => { if (disabled) return; setBuf(value); setEditing(true); };
  const commit = () => {
    setEditing(false);
    const same = buf.length === value.length && [...buf].sort().join() === [...value].sort().join();
    if (!same) onCommit(buf);
  };
  useEffect(() => {
    if (!editing) return undefined;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) commit(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, buf]);
  if (disabled || !editing) {
    return (
      <div onClick={disabled ? undefined : start} style={disabled ? undefined : { cursor: 'pointer' }} title={disabled ? undefined : 'Click to edit'}>
        {labels?.length ? <LabelChips labels={labels} /> : <span className="faint">{disabled ? 'None' : 'Click to add labels'}</span>}
      </div>
    );
  }
  return (
    <div ref={boxRef}>
      <LabelPicker projectId={projectId} labels={options} value={buf} onChange={setBuf} />
      <button type="button" className="btn sm primary" style={{ marginTop: 8 }} onClick={commit}><Check size={13} strokeWidth={3} /> Done</button>
    </div>
  );
}

/** Click the card number: three ready-to-copy versions of it (just the number, number + title, and a Markdown link back to this card). */
function CopyCardNumberModal({ task, onClose }) {
  const toast = useToast();
  const number = ticketLabel(task);
  const link = `${window.location.origin}/projects/${task.project.id}?task=${task.id}`;
  const rows = [
    ['Card number', number],
    ['Number + title', `${number}: ${task.title}`],
    ['Markdown', `[${number}](${link})`],
  ];
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); }
    catch { // older browsers / non-secure pages: select a hidden text box and copy
      const t = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    toast.success('Copied', text.length > 60 ? `${text.slice(0, 60)}…` : text);
  };
  return (
    <Modal title="Copy Card Number" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        {rows.map(([label, text]) => (
          <div key={label}>
            <div className="xs faint" style={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" readOnly value={text} onFocus={(e) => e.target.select()} aria-label={label} />
              <button className="btn primary" onClick={() => copy(text)}>Copy</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** A small caption above a header control, so every dropdown says what it is for. */
function Cap({ t, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{t}</span>
      {children}
    </div>
  );
}

export default function TaskDrawer({ id, onClose }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { version, bump } = useTimer();
  const changeStatus = useStatusChange();
  const live = useLive();
  const { data: fetched, loading, error, reload, setData } = useFetch(() => api.get(`/tasks/${id}`), [id, version]);
  const data = fetched || getCachedTask(id); // a recent copy (hover prefetch / last open) shows instantly while the fresh one loads
  useEffect(() => { if (fetched) setCachedTask(id, fetched); }, [fetched, id]);
  // the "also set tracked time" checkbox defaults to checked (when the user has permission) the first time the task loads, then stays under the user's own control
  useEffect(() => {
    if (!syncTrackedInit.current && data?.canSyncTracked !== undefined) { setSyncTracked(!!data.canSyncTracked); syncTrackedInit.current = true; }
  }, [data?.canSyncTracked]);
  const foreignKids = useForeignLive(data?.subtasks || []); // other people's running/paused-but-unsaved time on the subtasks; called unconditionally (hooks rule) even before data loads
  const [uploading, setUploading] = useState(false);
  // A subtask is a "point" inside its parent: clicking it opens it here (description + its own comments, time and history) without leaving the task.
  const [activeSubId, setActiveSubId] = useState(null);
  useEffect(() => { setActiveSubId(null); }, [id]);
  const { data: subFetched, reload: reloadSub, setData: setSubData } = useFetch(() => (activeSubId ? api.get(`/tasks/${activeSubId}`) : Promise.resolve(null)), [activeSubId, version]);
  const [tab, setTab] = useState('comments');
  const [hideDetails, setHideDetails] = useState(false); // like Trello's "Hide details": comments only
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [subOpen, setSubOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false); // the "Copy Card Number" popup
  const [logOpen, setLogOpen] = useState(false); // owner / project manager: add a time correction on a subtask
  const [editEntry, setEditEntry] = useState(null); // owner / project manager: edit or delete a tracked entry
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(null); // { file, preview } — an image staged (pasted or picked) for the next comment
  const [syncTracked, setSyncTracked] = useState(false); // estimate field: "also set tracked time to this value", defaulted once below once permissions are known
  const syncTrackedInit = useRef(false);
  const [params, setParams] = useSearchParams();
  const openTask = (tid) => { const p = new URLSearchParams(params); p.set('task', tid); setParams(p); };

  const task = data?.task;
  const subData = activeSubId && subFetched?.task?.id === activeSubId ? subFetched : null; // what the right-hand panel shows while a subtask is open
  const rp = subData || data;
  const rpTask = rp?.task;
  const merged = !!data && !subData && !data.task.parent; // a main ticket: comments and activity in one feed, like Trello
  const feed = !rp ? [] : [
    ...rp.comments.map((c) => ({ kind: 'comment', key: `c-${c.id}`, c, at: c.createdAt })),
    ...(merged && !hideDetails ? rp.activity.map((a) => ({ kind: 'event', key: `a-${a.id}`, a, at: a.createdAt })) : []),
  ].sort((x, y) => new Date(y.at) - new Date(x.at));
  const project = data?.project || null; // the task response already carries the project (members, lists, labels): no second request

  if (error) return <Drawer onClose={onClose} header={<button className="btn ghost icon" onClick={onClose}><X size={18} /></button>}><Empty title="Can’t open this task">{error.message}</Empty></Drawer>;
  if (!task) return (
    <Drawer onClose={onClose} header={<Skeleton h={28} w="60%" />}>
      <div className="stack"><Skeleton h={90} /><Skeleton h={160} /><Skeleton h={200} /></div>
    </Drawer>
  );

  const members = (project?.members || []).filter((m) => m.role !== 'viewer'); // viewers are read-only, never assignable
  const canManage = data.canManage;
  const mine = task.assignee?.id === user.id || task.collaborators.some((c) => c.id === user.id);
  const canStatus = can.track && (canManage || mine);
  const isSub = !!task.parent;
  // Saved totals + time from running/paused timers that has not been saved yet => numbers move live.
  const liveSelf = live(task.id);
  const liveKids = live(data.subtasks.map((s) => s.id));
  const t = { ...task.totals, direct: task.totals.direct + liveSelf, children: task.totals.children + liveKids + foreignKids, total: task.totals.total + liveSelf + liveKids + foreignKids };
  t.used = t.derived ? t.children : t.total; // time that counts against the estimate

  const patch = async (body, { successMsg } = {}) => {
    try {
      const before = task.status;
      const r = await api.patch(`/tasks/${task.id}`, body);
      setData((d) => ({ ...d, task: r }));
      bump();
      if (before === 'completed' && r.status !== 'completed') toast.success('Task saved and reopened', 'It was Completed. Adding time reopened it as In Progress, so you can start the timer.');
      else if (successMsg) toast.success(successMsg);
      return r;
    } catch (e) { toast.error('Could not save', e.message); reload(); return null; }
  };
  const setStatus = async (status) => { if (await changeStatus(task, status)) reload(); };
  const toggleSub = async (s) => { await changeStatus(s, s.status === 'completed' ? 'in_progress' : 'completed'); reload(); };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this work?', message: 'This permanently removes it. Work that already has tracked time can’t be deleted — cancel it instead.', danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/tasks/${task.id}`); toast.success('Deleted'); bump(); onClose(); } catch (e) { toast.error('Cannot delete', e.message); }
  };
  // Any file type is supported (matching Trello's own attachments: images, PDFs, docs, zips, …) — images get an inline thumbnail, everything else a file chip.
  const stageFile = (file) => {
    if (!file) return;
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    setPending({ file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
  };
  const clearPending = () => { if (pending?.preview) URL.revokeObjectURL(pending.preview); setPending(null); };
  const pickFile = (e) => { stageFile(e.target.files?.[0]); e.target.value = ''; }; // reset so picking the same file again still fires onChange
  const pasteImage = (e) => {
    if (subData) return; // subtasks are internal: there is no Trello card to attach files to
    const file = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file')?.getAsFile();
    if (file) { e.preventDefault(); stageFile(file); }
  };
  // Sends the typed text (if any) together with a pasted/attached file (if any) as ONE comment — mirrors Trello's own composer.
  const addComment = async () => {
    const text = comment.trim();
    if (!text && !pending) return;
    setUploading(true);
    try {
      let body = text;
      if (pending) {
        const { attachment } = await api.upload(`/tasks/${rpTask.id}/attachment`, pending.file);
        const isImage = pending.file.type.startsWith('image/');
        const safeName = pending.file.name.replace(/[[\]]/g, '');
        const fileLine = isImage ? `![${safeName}](${attachment.url})` : `[${safeName}](${attachment.url})`; // same syntax Trello uses, so it also reads well on the card
        body = `${fileLine}${text ? `\n\n${text}` : ''}`;
        // shows up in the Attachments section right away, without waiting for the next sync to pull it back in
        if (!rpTask.parent) {
          const entry = { trelloId: attachment.id, name: attachment.name || pending.file.name, url: attachment.url, bytes: attachment.bytes, mimeType: attachment.mimeType, date: attachment.date, previewUrl: attachment.previews?.length ? attachment.previews[attachment.previews.length - 1].url : null };
          setData((d) => ({ ...d, task: { ...d.task, attachments: [entry, ...(d.task.attachments || [])] } }));
        }
      }
      const c = await api.post(`/tasks/${rpTask.id}/comments`, { body });
      if (subData) setSubData((d) => ({ ...d, comments: [...d.comments, c] }));
      else setData((d) => ({ ...d, comments: [...d.comments, c] }));
      if (c.trelloSyncFailed) toast('Saved, but not synced to Trello', { type: 'warn', message: 'The comment is here, but posting it to the Trello card failed.' });
      setComment('');
      clearPending();
    } catch (e) { toast.error('Comment failed', e.message); } finally { setUploading(false); }
  };

  // ---- every field commits directly on change/blur — no separate edit mode
  const canTitleEdit = canManage || data.canEstimate || data.canEditRequirements;
  const onTrelloCard = !task.chronosOnly && task.trello?.kind === 'card';
  const linkedToTrello = new Set((project?.trello?.memberMap || []).map((m) => String(m.userId?.id || m.userId))); // Chronos people we can put on the Trello card
  const commitAssignee = async (newMainId, newCollaboratorIds = []) => {
    const stayIds = [newMainId, ...newCollaboratorIds].filter(Boolean);
    const leaving = !isSub ? assignedPeople.filter((m) => !stayIds.includes(m.id)) : [];
    if (leaving.length) {
      const trackedBy = (pid) => data.entries.some((e) => e.user?.id === pid) || data.subtasks.some((st) => st.assignee?.id === pid);
      const withHistory = leaving.filter((m) => trackedBy(m.id));
      if (!(await confirm({
        title: `Remove ${leaving.map((m) => m.name.split(' ')[0]).join(', ')} from this ticket?`,
        message: `${withHistory.length ? 'Their tracked time, comments and subtasks stay on the ticket and in reports. ' : ''}They are only taken off the assignee list${onTrelloCard ? ', and off the Trello card' : ''}. Use this when work moves on to someone else, for example from development to QA.`,
        confirmLabel: 'Remove',
      }))) { reload(); return; }
    } else if (!newMainId && task.assignee && !(await confirm({ title: 'Remove the assignee?', message: `“${task.title}” will have nobody assigned, so nobody can track time on it.`, confirmLabel: 'Remove assignee', danger: true }))) return;
    if (!isSub && onTrelloCard) {
      const missing = [newMainId, ...newCollaboratorIds].filter((pid) => pid && !linkedToTrello.has(pid)).map((pid) => members.find((m) => m.id === pid)?.name).filter(Boolean);
      if (missing.length) toast('Saved in Chronos, not on the Trello card', { type: 'warn', message: `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not linked to a Trello account. Link them in People, Edit, so the card shows them too.` });
    }
    patch(isSub ? { assignee: newMainId || null } : { assignee: newMainId || null, collaborators: newCollaboratorIds });
  };
  const commitEstimate = async (seconds) => {
    const syncing = isSub && data.canSyncTracked && syncTracked && seconds !== task.estimateSeconds;
    if (syncing && Math.round(task.totals.direct) !== seconds
      && !(await confirm({ title: 'Update tracked time too?', message: `The estimate becomes ${fmtHM(seconds)} and the tracked time changes from ${fmtHM(task.totals.direct)} to ${fmtHM(seconds)}. Time entries are adjusted (a correction is added, or time is taken off the newest entries) and everything is recorded in the audit log.`, confirmLabel: 'Update both' }))) return;
    patch(syncing ? { estimateSeconds: seconds, syncTracked: true } : { estimateSeconds: seconds });
  };
  const assignedPeople = [task.assignee, ...(task.collaborators || [])].filter(Boolean); // parent task: everyone on it (the first is the main assignee)

  const addToTrello = async () => {
    const onTrelloList = (project?.trello?.lists || []).some((l) => l.id === task.localStage);
    if (!onTrelloList) return toast.error('Choose a Trello list first', 'Move the task into one of the Trello lists, then press Add to Trello.');
    if (!(await confirm({ title: 'Add this task to Trello?', message: 'A card is created on the Trello board, in this list. Subtasks and tracked time stay in Chronos only. Changes you make to the ticket afterwards are synced to the card.', confirmLabel: 'Add to Trello' }))) return;
    try { await api.post(`/tasks/${task.id}/add-to-trello`, {}); toast.success('Added to Trello'); bump(); reload(); } catch (e) { toast.error('Could not add to Trello', e.message); }
  };

  const header = (
    <>
      <div className="row between">
        <div className="row small muted ellipsis">
          <span className="dot" style={{ '--c': task.project.color }} /> {task.project.name}
          {isSub && <><ChevronRight size={14} /><button className="btn ghost sm" style={{ padding: '2px 6px' }} onClick={() => openTask(task.parent)}>← parent task</button></>}
          <Badge color="var(--primary-2)" dot={false}>{isSub ? 'Subtask' : 'Task'}</Badge>{task.ticketNumber && <button type="button" className="ticket on" style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: '0 0 0 4px' }} onClick={() => setCopyOpen(true)} title="Chronos ticket number (click to copy)">{ticketLabel(task)}</button>}
          {!isSub && !task.chronosOnly && task.trello?.kind === 'card' && task.trello.idShort != null && (
            <a className="chip" href={task.trello.shortUrl} target="_blank" rel="noreferrer" title="This ticket's card number in Trello" style={{ marginLeft: 4 }}>Trello #{task.trello.idShort}</a>
          )}
        </div>
        <div className="row">
          {canManage && <button className="btn ghost icon sm" onClick={remove} title="Delete"><Trash2 size={16} /></button>}
          <button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
      </div>
      <InlineText value={task.title} disabled={!canTitleEdit} required requiredMessage="Title is required" maxLength={200} ariaLabel="Title"
        style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 4px', display: 'block' }}
        inputStyle={{ fontSize: 19, fontWeight: 800, marginTop: 8, letterSpacing: '-0.02em' }}
        onCommit={(v) => patch({ title: v })} />
      {(task.labels?.length > 0 || task.trello?.shortUrl) && (
        <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
          <LabelChips labels={task.labels} />
          {task.trello?.shortUrl && <a className="chip" href={task.trello.shortUrl} target="_blank" rel="noreferrer" title="Open this card in Trello"><ExternalLink size={11} /> Open in Trello</a>}
        </div>
      )}
      <div className="row wrap" style={{ marginTop: 10, alignItems: 'flex-end' }}>
        {isSub && (<Cap t="Status"><Select className="sm" style={{ width: 150, color: STATUS[task.status].color, fontWeight: 700 }} value={task.status} disabled={!canStatus} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select></Cap>)}
        <Cap t="Priority">{canManage ? (
          <Select className="sm" style={{ width: 120 }} value={task.priority} onChange={(e) => patch({ priority: e.target.value })} aria-label="Priority">
            {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        ) : <PriorityBadge priority={task.priority} />}</Cap>
        {project?.trello && !isSub && (task.trello?.kind === 'card' || task.chronosOnly) && (
          <Cap t="List"><Select className="sm" style={{ width: 170 }} value={task.localStage || task.trello?.idList || ''} disabled={!canStatus} onChange={(e) => patch({ stageId: e.target.value })} aria-label="List" title={task.chronosOnly ? 'List (Chronos only: moving it never touches Trello)' : 'List (moving it to a Trello list moves the card in Trello)'}>
            <optgroup label="Trello lists">{project.trello.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>
            {(project.localLists || []).length > 0 && <optgroup label="Chronos only">{project.localLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>}
          </Select></Cap>
        )}
        {task.chronosOnly && <span className="chip" title="Exists only in Chronos. Not in Trello.">Chronos only</span>}
        {task.chronosOnly && !isSub && canManage && project?.trello?.boardId && <button className="btn sm" onClick={addToTrello}>Add to Trello</button>}
        {isOverdue(task) && <span className="chip danger">Overdue</span>}
        {!isSub && (
          <>
            <Cap t="Assigned to"><div style={{ minWidth: 160 }} title={data.canReassign ? 'One or more people, the first is the main assignee' : undefined}>
              {!data.canReassign
                ? (assignedPeople.length
                  ? <div className="row wrap" style={{ gap: 6 }}>{assignedPeople.map((m) => <span key={m.id} className="chip"><Avatar user={m} size={18} /> {m.name.split(' ')[0]}</span>)}</div>
                  : <span className="faint small">Unassigned</span>)
                : <PeoplePicker members={members} value={assignedPeople.map((m) => m.id)} notOnTrello={onTrelloCard ? new Set(members.filter((m) => !linkedToTrello.has(m.id)).map((m) => m.id)) : undefined} onChange={(v) => commitAssignee(v[0] || '', v.slice(1))} />}
            </div></Cap>
            <Cap t="Deadline">{canManage
              ? <input type="date" className="input sm" style={{ width: 150 }} aria-label="Deadline" min={dateStr()} value={toInputDate(task.deadline)} onChange={(e) => patch({ deadline: e.target.value || null })} />
              : <span className="chip">{task.deadline ? fmtDate(task.deadline) : 'No deadline'}</span>}</Cap>
          </>
        )}
        <div className="right">{isSub ? <TimerButton task={task} big /> : <span className="xs faint">Time is tracked on subtasks ↓</span>}</div>
      </div>
    </>
  );

  const saveEdit = async (c) => {
    const text = editText.trim();
    if (!text) return;
    try {
      const r = await api.patch(`/tasks/${rpTask.id}/comments/${c.id}`, { body: text });
      const upd = (d) => ({ ...d, comments: d.comments.map((x) => (x.id === c.id ? { ...x, ...r } : x)) });
      if (subData) setSubData(upd); else setData(upd);
      setEditingId(null);
      if (r.trelloSyncFailed) toast('Saved, but not updated on Trello', { type: 'warn', message: 'The comment changed here, but the Trello card still shows the old text.' });
    } catch (e) { toast.error('Could not save the comment', e.message); }
  };
  const deleteComment = async (c) => {
    if (!(await confirm({ title: 'Delete this comment?', message: c.trelloCommentId ? 'It is removed here and from the Trello card.' : 'It is removed permanently.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      const r = await api.del(`/tasks/${rpTask.id}/comments/${c.id}`);
      const upd = (d) => ({ ...d, comments: d.comments.filter((x) => x.id !== c.id) });
      if (subData) setSubData(upd); else setData(upd);
      if (r.trelloSyncFailed) toast('Deleted here, but not on Trello', { type: 'warn', message: 'The Trello card still shows this comment.' });
    } catch (e) { toast.error('Could not delete the comment', e.message); }
  };

  const commentComposer = can.track && (
    <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
      {pending && (
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          {pending.preview
            ? <img src={pending.preview} alt={pending.file.name} style={{ height: 60, borderRadius: 8, display: 'block' }} />
            : <div className="row" style={{ gap: 6, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', flex: 'none' }}><FileText size={16} /><span className="xs ellipsis" style={{ maxWidth: 140 }}>{pending.file.name}</span></div>}
          <span className="xs faint ellipsis">{pending.preview ? pending.file.name : `${Math.round(pending.file.size / 1024)} KB`}</span>
          <button className="btn ghost icon sm" onClick={clearPending} aria-label="Remove file" title="Remove"><X size={14} /></button>
        </div>
      )}
      {!subData && !task.chronosOnly && task.trello?.kind === 'card' && <div className="xs faint">Comments here are also posted on the Trello card.</div>}
      {(subData || task.chronosOnly || task.trello?.kind !== 'card') && <div className="xs faint">Internal: this comment stays in Chronos.</div>}
      <div className="row">
        {rpTask.trello?.cardId && (
          <>
            <input id="attach-file" type="file" style={{ display: 'none' }} onChange={pickFile} disabled={uploading} />
            <label htmlFor="attach-file" className={`btn icon ${uploading ? '' : 'ghost'}`} title="Attach a file (or paste one into the comment box)" aria-label="Attach a file" style={uploading ? { opacity: 0.6, pointerEvents: 'none' } : undefined}>
              {uploading ? <Loader2 size={16} className="spin" /> : <Paperclip size={16} />}
            </label>
          </>
        )}
        <input className="input" placeholder="Write a comment… (paste an image to attach it)" value={comment}
          onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addComment()} onPaste={pasteImage} />
        <button className="btn primary icon" onClick={addComment} disabled={uploading} aria-label="Send"><Send size={16} /></button>
      </div>
    </div>
  );

  return (
    <Drawer onClose={onClose} header={header}>
      <div className="td-cols">
        {/* ---- left: details ---- */}
        <div className="td-left">
          <div className="stack" style={{ gap: 18 }}>
            <LiveTotal task={task} totals={t} />

            {/* ---- time roll-up */}
            <section>
              <div className={`grid gap-3 ${isSub ? 'grid-cols-2' : 'grid-cols-3'}`}>
                <StatTile label="Estimate" value={t.estimate == null ? '—' : fmtHM(t.estimate)} />
                {isSub ? <StatTile label="Tracked" value={fmtHM(t.direct)} highlight /> : <StatTile label="Total effort" value={fmtHM(t.total)} highlight />}
                {!isSub && <StatTile label="Total subtasks" value={String(t.subtaskCount || 0)} />}
              </div>
              <div style={{ marginTop: 14 }}><EstimateBar totals={{ ...t, total: t.used }} /></div>
              {estimateUsedUp(task.totals.used ?? task.totals.total, task.totals.estimate) && !['completed', 'cancelled'].includes(task.status) && (
                <div className="callout warn" style={{ marginTop: 12 }}><Info size={16} style={{ flex: 'none', marginTop: 2 }} /><span><b>Estimate fully used.</b> Timer is locked for this task. {data.canEstimate ? 'Increase the estimate (edit ✏️) to allow more tracking.' : 'Ask the owner or project manager to increase the estimate to keep tracking.'}</span></div>
              )}
              {!isSub && t.subtaskCount > 0 && <div className="small muted" style={{ marginTop: 10 }}>Total = direct time on this task + time on its subtasks · {t.subtaskDone}/{t.subtaskCount} subtasks done</div>}
            </section>

            {/* ---- details */}
            <section className="card" style={{ padding: 18 }}>
              <div className="form-grid">
                {isSub ? (
                  <Field label="Assignee" hint="A subtask has exactly one person.">
                    {!data.canReassign ? <div className="row"><Avatar user={task.assignee} size={26} /> {task.assignee?.name || 'Unassigned'}</div> : (
                      <Select value={task.assignee?.id || ''} onChange={(e) => commitAssignee(e.target.value)}>
                        <option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </Select>
                    )}
                  </Field>
                ) : null}
                {isSub && (
                <Field label="Deadline">
                  {canManage
                    ? <input type="date" className="input" min={dateStr()} value={toInputDate(task.deadline)} onChange={(e) => patch({ deadline: e.target.value || null })} />
                    : <div>{task.deadline ? fmtDate(task.deadline) : '—'}</div>}
                </Field>
                )}
                {isSub && (
                <Field label={isSub ? 'Estimate' : 'Estimate (total of subtasks)'} hint={isSub ? (data.canEstimate ? `Hours planned for this subtask (${fmtHM(task.totals.used ?? task.totals.total)} tracked so far). Use +15 m / +30 m / +1 h to add time.` : task.status === 'completed' ? 'Only the owner can change the hours of completed work.' : undefined) : 'Always the sum of its subtasks. Set the hours on each subtask.'}>
                  {!isSub || !data.canEstimate ? <div>{t.estimate == null ? 'No estimate' : fmtHM(task.estimateSeconds ?? t.estimate)}{!isSub && data.estimateDerived && <span className="faint xs"> · from subtasks</span>}</div> : (
                    <>
                      <DurationInput value={task.estimateSeconds} onChange={() => {}} onCommit={commitEstimate} />
                      {data.canSyncTracked && <label className="row xs" style={{ gap: 6, marginTop: 8 }}>
                        <input type="checkbox" checked={syncTracked} onChange={(e) => setSyncTracked(e.target.checked)} /> Also set tracked time to this value
                      </label>}
                    </>
                  )}
                </Field>
                )}
                {project?.trello && !isSub && (
                  <Field label="Labels" full>
                    <InlineLabels labels={task.labels} value={(task.labels || []).map((l) => l.trelloId).filter(Boolean)}
                      options={project.trello.labels} projectId={project.id} disabled={!canManage}
                      onCommit={(v) => patch({ labelIds: v })} />
                  </Field>
                )}
                <Field label="Description" full hint={isSub ? 'Internal: never sent to Trello.' : task.trello?.kind === 'card' && !task.chronosOnly ? 'Synced with the Trello card.' : 'Internal: this ticket is not in Trello.'}>
                  <InlineText multiline value={task.description} disabled={!data.canEditRequirements} emptyLabel="No description"
                    placeholder="Add context, links, details…" onCommit={(v) => patch({ description: v })} />
                </Field>
              </div>
            </section>

            {/* ---- attachments (Trello card files, pulled read-only — upload via the comment box on the right) */}
            {!isSub && task.trello?.kind === 'card' && (
              <section>
                <div className="card-title">
                  <h3>Attachments <span className="faint" style={{ fontWeight: 500 }}>{task.attachments?.length || 0}</span></h3>
                </div>
                {!task.attachments?.length ? (
                  <div className="faint small" style={{ padding: '6px 2px' }}>No files yet. Paste or attach an image from the comment box to add one.</div>
                ) : (
                  <div className="attachment-grid">
                    {task.attachments.map((a) => (
                      <a key={a.trelloId} href={a.url} target="_blank" rel="noreferrer" className="attachment-card">
                        {a.previewUrl ? <TrelloImage url={a.previewUrl} alt={a.name} plain style={{ width: '100%', height: 84, maxHeight: 84, margin: 0, objectFit: 'cover' }} /> : <div className="attachment-icon"><FileText size={22} /></div>}
                        <div className="attachment-meta">
                          <div className="ellipsis small" style={{ fontWeight: 600 }}>{a.name}</div>
                          <div className="xs faint">Added {a.date ? ago(a.date) : 'recently'}</div>
                        </div>
                        <ExternalLink size={13} className="attachment-open" />
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ---- subtasks */}
            {!isSub && (
              <section>
                <div className="card-title">
                  <h3>Subtasks <span className="faint" style={{ fontWeight: 500 }}>{t.subtaskDone}/{t.subtaskCount}</span></h3>
                  {(canManage || task.assignee?.id === user.id) && <button className="btn sm" onClick={() => setSubOpen(true)}><Plus size={14} /> Add subtask</button>}
                </div>
                {t.subtaskCount > 0 && <div style={{ marginBottom: 10 }}><Progress value={t.progress} thin /></div>}
                {data.estimateDerived && (
                  <div className="callout" style={{ marginBottom: 12, alignItems: 'center' }}>
                    <Info size={16} style={{ flex: 'none' }} />
                    <div className="grow small"><b>Task hours = total of its subtasks' hours</b> ({fmtHM(task.estimateSeconds)}). The owner or project manager sets the hours on each subtask; team members track time on their subtask with the timer.</div>
                  </div>
                )}
                {data.subtasks.length === 0 ? (
                  <div className="faint small" style={{ padding: '6px 2px' }}>No subtasks. Break this task down to assign parts to different teammates and track time on each.</div>
                ) : data.subtasks.map((s) => {
                  const open = activeSubId === s.id;
                  return (
                  <div key={s.id} className={`subpoint ${open ? 'open' : ''}`}>
                    <div className="task-row" style={open ? { background: 'var(--surface-2)' } : undefined} onClick={() => { setActiveSubId(open ? null : s.id); setTab('comments'); }}>
                      <button className={`check ${s.status === 'completed' ? 'on' : ''}`} disabled={!can.track || !(canManage || s.assignee?.id === user.id)}
                        onClick={(e) => { e.stopPropagation(); toggleSub(s); }} aria-label="Toggle complete"><Check size={13} strokeWidth={3} /></button>
                      <div className="grow">
                        <div style={{ fontWeight: 600, textDecoration: s.status === 'completed' ? 'line-through' : 'none', opacity: s.status === 'completed' ? 0.6 : 1 }} className="ellipsis">{s.ticketCode && <span className="ticket">{s.ticketCode}</span>}{s.title}</div>
                        <div className="xs faint">{STATUS[s.status].label}{s.deadline && ` · due ${fmtDate(s.deadline)}`} · <LiveHM base={s.totals.direct} ids={s.id} />{s.totals.estimate != null && ` / ${fmtHM(s.totals.estimate)}`}</div>
                      </div>
                      <Avatar user={s.assignee} size={26} />
                      <TimerButton task={s} />
                    </div>
                    {open && (
                      <div className="stack" style={{ padding: '10px 12px 14px 44px', gap: 10 }}>
                        <div className="xs faint" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Subtask description <span style={{ textTransform: 'none', fontWeight: 500 }}>· internal, never sent to Trello</span></div>
                        {!subData ? <Skeleton h={56} /> : (
                          <InlineText multiline value={subData.task.description} disabled={!subData.canEditRequirements} emptyLabel="No description"
                            placeholder="Add details for this subtask…"
                            onCommit={async (v) => { try { const r = await api.patch(`/tasks/${s.id}`, { description: v }); setSubData((d) => ({ ...d, task: r })); } catch (e) { toast.error('Could not save', e.message); } }} />
                        )}
                        <div><button className="btn ghost sm" onClick={() => openTask(s.id)}>Open full subtask <ChevronRight size={13} /></button></div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </section>
            )}
          </div>
        </div>

        {/* ---- right: comments and activity (Trello-style side panel) ---- */}
        <div className="td-right">
          <div className="td-right-head">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3>{subData ? 'Subtask comments and activity' : 'Comments and activity'}</h3>
            </div>
            {subData && (
              <div className="row between" style={{ marginBottom: 10, gap: 8 }}>
                <div className="small ellipsis"><b>{subData.task.ticketCode || 'Subtask'}</b> · {subData.task.title}</div>
                <button className="btn ghost sm" onClick={() => setActiveSubId(null)}><X size={13} /> Back to task</button>
              </div>
            )}
            <div className="tabs">
              <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}><MessageSquare size={14} /> {merged ? 'Comments and activity' : 'Comments'} <span className="n">{rp.comments.length}</span></button>
              <button className={tab === 'time' ? 'on' : ''} onClick={() => setTab('time')}><Clock size={14} /> Time <span className="n">{rp.entries.length}</span></button>
              {!merged && <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}><History size={14} /> Activity</button>}
            </div>
          </div>

          <div className="td-right-scroll">
            {tab === 'comments' && (
              <>
                {merged && <div className="row between" style={{ marginBottom: 8 }}><span className="xs faint">Everything that happens on this ticket, newest first.</span><button className="btn sm" onClick={() => setHideDetails((v) => !v)}>{hideDetails ? 'Show details' : 'Hide details'}</button></div>}
                {commentComposer}
                <div className="stack">
                  {feed.length === 0 && <div className="faint small">No comments yet. Start the conversation.</div>}
                  {feed.map((it) => it.kind === 'event' ? (
                    <div key={it.key} className="row" style={{ alignItems: 'flex-start' }}>
                      <Avatar user={it.a.actor || { name: '?' }} size={32} />
                      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                        <div className="small">{it.a.source === 'trello' ? <><b>{it.a.actor?.name}</b> {it.a.summary}</> : <>{it.a.actor?.name && <b>{it.a.actor.name}</b>} {it.a.summary}</>}</div>
                        <div className="xs faint">{ago(it.at)}{it.a.source === 'trello' ? ' · Trello' : ''}</div>
                      </div>
                    </div>
                  ) : (
                    <div key={it.key} className="row" style={{ alignItems: 'flex-start' }}>
                      <Avatar user={it.c.user} size={32} />
                      <div className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 0, borderRadius: 14 }}>
                        <div className="row small">
                          <b>{it.c.user?.name || it.c.trelloAuthorName || 'Trello'}</b>
                          {it.c.source === 'trello' && <Badge color="#0079bf" dot={false}>via Trello</Badge>}
                          {it.c.source !== 'trello' && it.c.trelloCommentId && <Badge color="#0079bf" dot={false}>on Trello</Badge>}
                          <span className="faint">{ago(it.c.createdAt)}{it.c.editedAt ? ' · edited' : ''}</span>
                        </div>
                        {editingId === it.c.id ? (
                          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                            <textarea className="input" rows={3} autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} />
                            <div className="row"><button className="btn sm primary" disabled={!editText.trim()} onClick={() => saveEdit(it.c)}>Save</button><button className="btn sm ghost" onClick={() => setEditingId(null)}>Cancel</button></div>
                          </div>
                        ) : <CommentBody text={it.c.body} />}
                        {editingId !== it.c.id && it.c.source !== 'trello' && (it.c.user?.id === user.id || user.role === 'owner') && (
                          <div className="row xs faint" style={{ gap: 6, marginTop: 6 }}>
                            {it.c.user?.id === user.id && <><button type="button" className="link" onClick={() => { setEditingId(it.c.id); setEditText(it.c.body); }}>Edit</button><span>•</span></>}
                            <button type="button" className="link" onClick={() => deleteComment(it.c)}>Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === 'time' && (isSub || subData) && rp.canAssign && <div className="row" style={{ marginBottom: 10 }}><button className="btn sm" onClick={() => setLogOpen(true)}><PenLine size={14} /> Add time (correction)</button></div>}
            {tab === 'time' && (rp.entries.length === 0 ? <Empty icon={Clock} title="No time tracked yet">Start the timer on a subtask to record time.</Empty> : rp.entries.map((e) => (
              <div key={e.id} className="entry" style={{ '--pc': e.user.color }}>
                <div className="bar" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row small between">
                    <div className="row small" style={{ minWidth: 0 }}><Avatar user={e.user} size={22} /><b className="ellipsis">{e.user.name}</b></div>
                    <div className="row" style={{ gap: 6, flex: 'none' }}>
                      <b className="tnum">{fmtHM(e.durationSeconds)}</b>
                      {rp.canAssign && <button className="btn ghost icon sm" onClick={() => setEditEntry(e)} aria-label="Edit tracked time" title="Edit tracked time"><Pencil size={14} /></button>}
                    </div>
                  </div>
                  <div className="row wrap xs faint" style={{ marginTop: 4, gap: 6 }}>
                    <span>{fmtDay(e.workDate)}</span>
                    <ApprovalBadge status={e.approvalStatus} />
                    {e.task.id !== rpTask.id && <span className="chip">↳ {e.task.title}</span>}
                    {e.source === 'manual' && <span className="chip">manual</span>}
                    {e.overlap && <span className="chip warn">overlap</span>}
                  </div>
                  {e.description && <div className="xs muted ellipsis" style={{ marginTop: 4 }}>{e.description}</div>}
                </div>
              </div>
            )))}

            {tab === 'activity' && (rp.activity.length === 0 ? <div className="faint small">No recorded activity yet.</div> : (
              <div className="timeline">
                {rp.activity.map((a) => <div key={a.id} className="ev"><div className="small">{a.source === 'trello' ? <><b>{a.actor?.name}</b> {a.summary}</> : a.summary}</div><div className="xs faint">{a.source === 'trello' ? <>Trello · {ago(a.createdAt)}</> : <>{a.actor?.name} · {ago(a.createdAt)}</>}</div></div>)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {copyOpen && task.ticketNumber && <CopyCardNumberModal task={task} onClose={() => setCopyOpen(false)} />}
      {logOpen && <TimeEntryModal task={rpTask} onClose={() => setLogOpen(false)} onSaved={() => { bump(); reload(); reloadSub(); }} />}
      {editEntry && <TimeEntryModal entry={editEntry} onClose={() => setEditEntry(null)} onSaved={() => { bump(); reload(); reloadSub(); }} />}
      {subOpen && <TaskFormModal parent={task} trello={project?.trello} members={members} onClose={() => setSubOpen(false)} onSaved={() => { bump(); reload(); }} />}
    </Drawer>
  );
}
