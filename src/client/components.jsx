import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Play, Pause, AlertTriangle, Lock, Paperclip, Trash2, X, Loader2, FileText, FileSpreadsheet, FileArchive, FileImage, ChevronDown, Check } from 'lucide-react';
import { api, qs } from './api';
import { useAuth, useConfirm, useTimer, useTick, useToast } from './context';
import { Avatar, Field, Modal, Select } from './ui';
import { LabelPicker } from './trello';
import { dateStr, estimateUsedUp, fmtClock, fmtHM, joinDuration, splitDuration, toInputDate } from './format';

/**
 * A Trello-hosted image (e.g. linked from a synced comment, or an attachment thumbnail), fetched through our
 * server since the browser can't attach our Trello credentials to a plain <img src>.
 * `plain`: render failures as inert text instead of a link — use when the caller already wraps this in a link.
 */
export function TrelloImage({ url, alt, style, plain = false }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    api.blobUrl(`/trello/image?url=${encodeURIComponent(url)}`).then((u) => {
      if (cancelled) { URL.revokeObjectURL(u); return; }
      objectUrl = u;
      setSrc(u);
    }).catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (failed) return plain
    ? <div className="faint xs">{alt || 'Image unavailable'}</div>
    : <a href={url} target="_blank" rel="noreferrer" className="small">{alt || 'View attachment on Trello'}</a>;
  if (!src) return <div className="faint xs">Loading image…</div>;
  return <img src={src} alt={alt || ''} title="Click to open full size" onClick={() => window.open(src, '_blank')} style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 10, display: 'block', cursor: 'zoom-in', ...style }} />;
}

// Markdown image/link syntax Trello generates for attachments: ![alt](url) for images, [name](url "") for other files.
// Allows one level of nested parens so a Trello filename like "photo_(2).png" inside the URL doesn't break the match,
// and an optional trailing "title" (Trello appends an empty one to non-image file links).
const MD_TOKEN = /(!?)\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*?)(?:\s+"[^"]*")?\)/g;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
// Markdown escapes Trello inserts into filenames (e.g. "photo\_1\(a\).png") — strip them back out for display.
const unescapeMd = (s) => s.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');


// ---- file attachments in comments: show the file's name and type (and a preview for images), never the raw link
const FILE_KINDS = [
  [/^(xlsx?|xlsm|csv|ods)$/i, 'Excel', 'sheet', '#16a34a'],
  [/^(docx?|odt|rtf)$/i, 'Word', 'doc', '#2563eb'],
  [/^(pptx?|odp)$/i, 'PowerPoint', 'doc', '#ea580c'],
  [/^pdf$/i, 'PDF', 'doc', '#dc2626'],
  [/^(zip|rar|7z|tar|gz)$/i, 'Archive', 'zip', '#a16207'],
  [/^(png|jpe?g|gif|webp|svg|bmp)$/i, 'Image', 'image', '#7c3aed'],
  [/^(mp4|mov|webm|avi|mkv)$/i, 'Video', 'doc', '#db2777'],
  [/^(txt|md|json|xml|log)$/i, 'Text', 'doc', '#475569'],
];
export const fileKind = (name) => {
  const ext = (/\.([a-z0-9]{1,5})(\?.*)?$/i.exec(name || '') || [])[1] || '';
  const hit = FILE_KINDS.find((k) => k[0].test(ext));
  return { ext: ext.toUpperCase(), label: hit ? hit[1] : ext ? ext.toUpperCase() : 'File', icon: hit ? hit[2] : 'doc', color: hit ? hit[3] : '#64748b' };
};
const isTrelloUrl = (u) => { try { return /(^|\.)trello\.com$/i.test(new URL(u).hostname); } catch { return false; } };
const nameFromUrl = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || 'Attachment'); } catch { return 'Attachment'; } };

/** A file as a compact chip: type icon, file name and type (Excel, PDF, …). Click to download; Trello-hosted files go through our server, which holds the Trello credentials. */
export function FileChip({ name, url }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const k = fileKind(name);
  const Icon = { sheet: FileSpreadsheet, zip: FileArchive, image: FileImage }[k.icon] || FileText;
  const open = async (e) => {
    if (!isTrelloUrl(url)) return; // an ordinary link: let the browser follow it
    e.preventDefault();
    setBusy(true);
    try {
      const blobUrl = await api.blobUrl(`/trello/image?url=${encodeURIComponent(url)}`);
      const a = Object.assign(document.createElement('a'), { href: blobUrl, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch { toast.error('Could not download', 'Open it from the Trello card instead.'); } finally { setBusy(false); }
  };
  return (
    <a href={url} onClick={open} target="_blank" rel="noreferrer" title={`Download ${name}`} className="row"
      style={{ gap: 10, alignItems: 'center', width: 'fit-content', maxWidth: '100%', padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'inherit', textDecoration: 'none' }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, flex: 'none', background: `${k.color}22`, color: k.color }}>{busy ? <Loader2 size={17} className="spin" /> : <Icon size={18} />}</span>
      <span style={{ minWidth: 0 }}>
        <span className="ellipsis" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{name}</span>
        <span className="xs faint">{k.label}{k.ext && k.label !== k.ext ? ` · ${k.ext}` : ''}</span>
      </span>
    </a>
  );
}

/** A chunk of comment text with any bare URLs turned into links — a Trello image URL renders inline instead. */
function TextWithLinks({ value }) {
  const bits = value.split(/(https?:\/\/\S+)/g);
  return bits.map((bit, i) => {
    if (!/^https?:\/\//.test(bit)) return bit ? <span key={i}>{unescapeMd(bit)}</span> : null;
    let host = '';
    try { host = new URL(bit).hostname; } catch { /* leave as a plain link */ }
    if (/(^|\.)trello\.com$/i.test(host) && IMAGE_EXT.test(bit)) return <TrelloImage key={i} url={bit} alt="" />;
    if (/(^|\.)trello\.com$/i.test(host) && /\/attachments\//.test(bit)) return <FileChip key={i} name={nameFromUrl(bit)} url={bit} />; // a bare Trello file link
    return <a key={i} href={bit} target="_blank" rel="noreferrer">{bit}</a>;
  });
}

/** Renders a comment body as plain text, except markdown image/link syntax (synced from or sent to Trello) which renders as real images or file links. */
export function CommentBody({ text: raw }) {
  const text = String(raw || '').replace(/📎\s*(.+?)\s*[—-]\s*(https?:\/\/\S+)/g, (_m, n, u) => `[${n.replace(/[[\]]/g, '')}](${u})`); // older comments stored files as "📎 name — link"
  const parts = [];
  let last = 0;
  let m;
  MD_TOKEN.lastIndex = 0;
  while ((m = MD_TOKEN.exec(text))) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    parts.push({ type: m[1] === '!' ? 'image' : 'link', alt: m[2], url: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {parts.map((p, i) => {
        if (p.type === 'image') return <TrelloImage key={i} url={p.url} alt={p.alt} style={{ border: '1px solid var(--border)' }} />;
        if (p.type === 'link') return isTrelloUrl(p.url) || /\.[a-z0-9]{2,5}$/i.test(unescapeMd(p.alt)) ? <FileChip key={i} name={unescapeMd(p.alt) || nameFromUrl(p.url)} url={p.url} /> : <a key={i} href={p.url} target="_blank" rel="noreferrer">{unescapeMd(p.alt) || p.url}</a>;
        return p.value.trim() && <div key={i} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><TextWithLinks value={p.value.trim()} /></div>;
      })}
    </div>
  );
}

/**
 * Seconds of timer time that are not yet saved to history (running or paused sessions).
 * Returns live(ids) => seconds, and re-renders every second while a timer is running,
 * so totals count up in real time instead of waiting for Stop.
 */
export function useLive() {
  const { sessions, elapsedOf } = useTimer();
  const now = useTick(sessions.some((s) => s.state === 'running'));
  return (ids) => {
    const set = new Set([].concat(ids));
    return sessions.reduce((sum, s) => (set.has(s.task?.id) ? sum + elapsedOf(s, now) : sum), 0);
  };
}

/** "1 h 5 m" for saved time + any unsaved timer time on the given task ids. */
export function LiveHM({ base, ids }) {
  const live = useLive();
  return fmtHM(base + live(ids));
}

/**
 * Seconds of OTHER people's unsaved timer time (running or paused) on a set of tasks — read-only,
 * using the server-reported `runningTimer` on each task. Excludes the current user's own session
 * (already counted by useLive) so time is never double-counted.
 */
export function useForeignLive(items) {
  const { user } = useAuth();
  const anyRunning = items.some((it) => it.runningTimer?.state === 'running' && it.runningTimer.userId !== user.id);
  const now = useTick(anyRunning);
  return items.reduce((sum, it) => {
    const r = it.runningTimer;
    if (!r || r.userId === user.id) return sum;
    return sum + r.accumulatedSeconds + (r.state === 'running' ? Math.max(0, (now - new Date(r.segmentStart).getTime()) / 1000) : 0);
  }, 0);
}

/**
 * Hours + minutes input. value/onChange use seconds (null = no estimate, 0 = explicit zero).
 * Typing 90 in minutes is normalised to 1 h 30 m when you leave the field.
 */
/** `onChange` fires live on every keystroke (for a responsive "= Xh Ym" preview / buffered form state).
 * `onCommit` (optional) fires only once the user is done editing — on blur, and on the +15m/+30m/+1h pills —
 * for callers that save straight to the server and don't want a network call per digit typed. */
export function DurationInput({ value, onChange, onCommit, disabled }) {
  const [h0, m0] = splitDuration(value);
  const [h, setH] = useState(h0);
  const [m, setM] = useState(m0);
  useEffect(() => { // follow external changes (e.g. cancel / reload) without fighting the user's typing
    if (joinDuration(h, m) !== value) { const [a, b] = splitDuration(value); setH(a); setM(b); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const update = (nh, nm) => { setH(nh); setM(nm); onChange(joinDuration(nh, nm)); };
  const normalise = () => {
    const s = joinDuration(h, m);
    if (s != null) { const [a, b] = splitDuration(s); setH(a); setM(b); }
    if (s !== value) onCommit?.(s);
  };
  return (
    <div className="row wrap" style={{ gap: 8 }}>
      <input type="number" min="0" inputMode="numeric" className="input" style={{ width: 84 }} placeholder="0" value={h} disabled={disabled} aria-label="Estimate hours"
        onChange={(e) => update(e.target.value, m)} onBlur={normalise} />
      <span className="muted small">h</span>
      <input type="number" min="0" inputMode="numeric" className="input" style={{ width: 84 }} placeholder="0" value={m} disabled={disabled} aria-label="Estimate minutes"
        onChange={(e) => update(h, e.target.value)} onBlur={normalise} />
      <span className="muted small">min</span>
      {value != null && <span className="faint xs">= {fmtHM(value)}</span>}
      {!disabled && (
        <div className="pills" style={{ flexBasis: '100%' }} aria-label="Add time to the estimate">
          {[[15, '+15 m'], [30, '+30 m'], [60, '+1 h']].map(([min, label]) => (
            <button key={min} type="button" title={`Add ${label.slice(1)} to the current estimate`}
              onClick={() => { const next = (joinDuration(h, m) ?? 0) + min * 60; const [a, b] = splitDuration(next); setH(a); setM(b); onChange(next); onCommit?.(next); }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Someone else's timer on this task (server-reported, read-only — never controllable here). Ticks live while running, static while paused-but-unsaved. */
function ForeignRunningBadge({ running, big }) {
  const isRunning = running.state === 'running';
  const now = useTick(isRunning);
  const elapsed = running.accumulatedSeconds + (isRunning ? Math.max(0, (now - new Date(running.segmentStart).getTime()) / 1000) : 0);
  return (
    <span className={`btn ${isRunning ? 'live' : 'ghost'}`} style={{ cursor: 'default', gap: 6 }}
      title={`${running.userName} ${isRunning ? 'is tracking time on this now' : 'paused a timer here — not yet saved'}`}>
      <span className={`dot ${isRunning ? 'pulse' : ''}`} style={isRunning ? undefined : { '--c': 'var(--warn)' }} />
      {big && <span className="small">{running.userName.split(' ')[0]} {isRunning ? 'tracking' : 'paused'}</span>}
      <b className="tnum">{fmtClock(elapsed)}</b>
    </span>
  );
}

/**
 * Pick one or more people for a PARENT task. value = array of user ids; the first is the main assignee, the rest are
 * the other people on the task. (Subtasks have exactly one assignee, so they use a plain select instead.)
 */
export function PeoplePicker({ members, value, onChange, width = 230, notOnTrello }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const wrap = useRef(null);
  useEffect(() => { if (!open) setDraft(value); }, [value, open]); // follow the saved value while the list is closed
  const close = () => {
    setOpen(false);
    if (draft.join() !== value.join()) onChange(draft); // one save for the whole selection, not one per click
  };
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);
  const toggleOpen = () => {
    if (open) return close();
    setDraft(value);
    setOpen(true);
  };
  const shown = value.map((id) => members.find((m) => m.id === id)).filter(Boolean);
  const toggle = (id) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  return (
    <div ref={wrap} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="input sm" onClick={toggleOpen} aria-haspopup="listbox" aria-expanded={open}
        style={{ width, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer' }}>
        {shown.length === 0
          ? <span className="faint">Unassigned</span>
          : <>
              <span style={{ display: 'flex' }}>{shown.slice(0, 3).map((m, i) => <span key={m.id} style={{ marginLeft: i ? -8 : 0, display: 'inline-flex' }}><Avatar user={m} size={20} /></span>)}</span>
              <span className="ellipsis" style={{ flex: 1, fontWeight: 600 }}>{shown[0].name.split(' ')[0]}{shown.length > 1 && <span className="faint"> +{shown.length - 1}</span>}</span>
            </>}
        <ChevronDown size={14} style={{ flex: 'none', opacity: 0.6 }} />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="ppick-list"
          style={{ left: 0, right: 'auto', width: Math.max(width, 260), zIndex: 120 }}>
          <div className="xs faint" style={{ padding: '6px 12px 4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Add or remove people</div>
          {members.length === 0 && <div className="faint small" style={{ padding: 10 }}>No team members</div>}
          {members.map((m) => {
            const on = draft.includes(m.id);
            return (
              <button key={m.id} type="button" role="option" aria-selected={on} className={on ? 'on' : ''} onClick={() => toggle(m.id)}>
                <span aria-hidden="true" style={{ width: 18, height: 18, flex: 'none', borderRadius: 5, display: 'grid', placeItems: 'center', border: `2px solid ${on ? 'var(--primary)' : 'var(--text-3)'}`, background: on ? 'var(--primary)' : 'transparent', color: '#fff' }}>{on && <Check size={12} strokeWidth={4} />}</span>
                <Avatar user={m} size={22} />
                <span className="ellipsis" style={{ flex: 1 }}>{m.name}</span>
                {m.pending && <span className="chip warn" title="Found on Trello. They cannot sign in until the admin approves them in People.">Awaiting approval</span>}
                {notOnTrello?.has(m.id) && <span className="chip" title="Not linked to a Trello account: they will not be added to the Trello card. Link them in People, Edit.">Not on Trello</span>}
                {on && draft[0] === m.id && draft.length > 1 && <span className="chip">Main</span>}
              </button>
            );
          })}
          <div className="xs faint" style={{ padding: '8px 12px 4px' }}>The first person you pick is the main assignee. Click outside to save.</div>
        </div>
      )}
    </div>
  );
}

/** Compact start / pause control for a subtask (a parent task has no timer: its time is the sum of its subtasks). */
export function TimerButton({ task, big = false }) {
  const { can } = useAuth();
  const { sessionFor, start, pause, busy } = useTimer();
  if (!can.track) return null;
  const { user } = useAuth();
  const s = sessionFor(task.id);
  // Time is tracked on subtasks only. (A timer that was already running on a parent task can still be paused.)
  if (!task.parent && s?.state !== 'running') return null;
  const closed = ['completed', 'cancelled'].includes(task.status);
  const stop = (e) => e.stopPropagation();
  // Only the assigned person can track time on a task (managers and the owner cannot track for someone else).
  const isAssignee = task.assignee?.id === user.id;
  // Estimate fully used => no more timing until someone increases the estimate (saved totals, as the server checks).
  const est = task.totals?.estimate;
  const exhausted = estimateUsedUp(task.totals?.used ?? task.totals?.total ?? 0, est); // 'used' = subtask time only when the estimate comes from subtasks
  if (isAssignee && exhausted && s?.state !== 'running' && !closed)
    return (
      <button className={`btn play ${big ? '' : 'icon sm'}`} disabled style={{ opacity: 0.5 }} onClick={stop}
        title={`The estimate (${fmtHM(est)}) is fully used. Increase it (Edit on this subtask) to keep tracking.`}>
        <Lock size={big ? 15 : 13} />{big && 'Estimate used'}
      </button>
    );
  if (isAssignee && closed && s?.state !== 'running')
    return (
      <button className={`btn play ${big ? '' : 'icon sm'}`} disabled style={{ opacity: 0.5 }} onClick={stop}
        title={`This task is ${task.status === 'completed' ? 'Completed' : 'Cancelled'}. Set it back to In Progress (or add time to its estimate) to track time.`}>
        <Lock size={big ? 15 : 13} />{big && (task.status === 'completed' ? 'Completed' : 'Cancelled')}
      </button>
    );
  if (!isAssignee && !s) {
    // Someone else's timer may be running right now — show it live (read-only), the lock/permission itself is unchanged.
    if (task.runningTimer) return <ForeignRunningBadge running={task.runningTimer} big={big} />;
    return (
      <button className={`btn play ${big ? '' : 'icon sm'}`} disabled style={{ opacity: 0.45 }} onClick={stop}
        title={task.assignee ? `Only ${task.assignee.name} can track time on this task` : 'Assign this task to someone before tracking time'}>
        <Lock size={big ? 15 : 13} />{big && (task.assignee ? `Only ${task.assignee.name.split(' ')[0]} can track` : 'Not assigned')}
      </button>
    );
  }
  if (s?.state === 'running')
    return (
      <button className={`btn live ${big ? '' : 'icon sm'}`} onClick={(e) => { stop(e); pause(); }} title="Timer running — click to pause">
        <Pause size={big ? 16 : 14} fill="currentColor" />{big && 'Pause timer'}
      </button>
    );
  return (
    <button className={`btn play ${big ? '' : 'icon sm'}`} disabled={busy || closed}
      onClick={(e) => { stop(e); start(task.id); }}
      title={closed ? 'Reopen this work to track time' : s ? 'Resume timer' : 'Start timer'}>
      <Play size={big ? 16 : 14} fill="currentColor" />{big && (s ? 'Resume timer' : 'Start timer')}
    </button>
  );
}

/** Changes a task status, handling the "required subtasks incomplete" rule and manager override. */
export function useStatusChange() {
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useTimer();
  return async (task, status, extra = {}) => {
    try {
      const r = await api.patch(`/tasks/${task.id}`, { status, ...extra });
      bump();
      return r;
    } catch (e) {
      if (e.code === 'SUBTASKS_INCOMPLETE_OVERRIDABLE') {
        const reason = await confirm({
          title: 'Complete with open subtasks?',
          message: `${e.message}. As a manager you may override this — your reason is recorded in the audit log.`,
          input: true, placeholder: 'Reason for override…', confirmLabel: 'Override & complete',
        });
        if (reason) {
          try { const r = await api.patch(`/tasks/${task.id}`, { status, overrideReason: reason, ...extra }); bump(); return r; } catch (e2) { toast.error('Could not update', e2.message); }
        }
      } else toast.error('Cannot change status', e.message);
      return null;
    }
  };
}

const splitHM = (sec) => ({ h: Math.floor(sec / 3600), m: Math.round((sec % 3600) / 60) });

/**
 * Tracked time is recorded by the timer. This dialog is how the owner / project manager CORRECTS it:
 *  - `entry`: edit an entry's duration / date, or delete it (an approved or submitted entry needs the owner and a reason)
 *  - `task` (a subtask): add a correction entry for the subtask's assignee (a reason is required)
 * A team member opening their own entry can only change its description.
 */
export function TimeEntryModal({ task, entry, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const clientId = useMemo(() => crypto.randomUUID(), []); // same key on retries => never duplicates
  const init = entry ? splitHM(entry.durationSeconds) : { h: 1, m: 0 };
  const [f, setF] = useState({ workDate: entry?.workDate || dateStr(), h: init.h, m: init.m, description: entry?.description || '', reason: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const canChangeTime = ['owner', 'manager'].includes(user.role);
  const isOwner = user.role === 'owner';
  const seconds = (Number(f.h) || 0) * 3600 + (Number(f.m) || 0) * 60;
  const approved = entry?.approvalStatus === 'approved';
  const locked = !!entry && !['draft', 'rejected'].includes(entry.approvalStatus);
  const who = entry?.user || task?.assignee;
  const target = entry?.task?.title || task?.title;
  const canDelete = !!entry && canChangeTime && (!locked || (isOwner && f.reason.trim().length >= 3));

  const save = async () => {
    setBusy(true);
    try {
      let r;
      if (entry) r = await api.patch(`/time-entries/${entry.id}`, { description: f.description, durationSeconds: seconds, workDate: f.workDate, reason: f.reason });
      else r = await api.post('/time-entries', { taskId: task.id, workDate: f.workDate, durationSeconds: seconds, description: f.description, clientId });
      toast.success(entry ? 'Entry updated' : `Added ${fmtHM(seconds)} to ${who?.name?.split(' ')[0] || 'the assignee'}`);
      onSaved?.(r.entry);
      onClose();
    } catch (e) { toast.error('Could not save', e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this time entry?', message: `${fmtHM(entry.durationSeconds)} will be removed from the tracked time and the totals.`, danger: true, confirmLabel: 'Delete entry' }))) return;
    setBusy(true);
    try { await api.del(`/time-entries/${entry.id}${qs({ reason: f.reason.trim() })}`); toast.success('Entry deleted'); onSaved?.(); onClose(); }
    catch (e) { toast.error('Could not delete', e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={entry ? 'Edit time entry' : 'Add time (correction)'} onClose={onClose}
      footer={<>
        {entry && canChangeTime && <button className="btn danger" onClick={remove} disabled={busy || !canDelete} title={locked && !canDelete ? 'Enter a reason first (owner only for submitted or approved entries)' : 'Delete this entry'}><Trash2 size={14} /> Delete</button>}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy || seconds < 60 || (!entry && f.description.trim().length < 3) || (approved && !f.reason.trim())}>{busy ? 'Saving…' : entry ? 'Save entry' : 'Add time'}</button>
      </>}>
      <div className="form-grid">
        <Field label="Subtask" full><div className="input" style={{ opacity: 0.85 }}>{target}</div></Field>
        <Field label="Person"><div className="input" style={{ opacity: 0.85 }}>{who?.name || '—'}</div></Field>
        <Field label="Work date"><input type="date" className="input" max={dateStr()} value={f.workDate} onChange={set('workDate')} disabled={!!entry && !canChangeTime} /></Field>
        <Field label="Duration" full hint={entry && !canChangeTime ? 'Only the owner or project manager can change tracked time.' : undefined}>
          <div className="row">
            <input type="number" min="0" max="24" className="input" value={f.h} onChange={set('h')} style={{ width: 90 }} disabled={!!entry && !canChangeTime} /> <span className="muted">h</span>
            <input type="number" min="0" max="59" step="5" className="input" value={f.m} onChange={set('m')} style={{ width: 90 }} disabled={!!entry && !canChangeTime} /> <span className="muted">min</span>
            {(!entry || canChangeTime) && <div className="pills right">{[[0, 30], [1, 0], [2, 0], [4, 0]].map(([h, m]) => <button key={h * 60 + m} type="button" onClick={() => setF((x) => ({ ...x, h, m }))}>{m ? `${m} m` : `${h} h`}</button>)}</div>}
          </div>
        </Field>
        <Field label={entry ? 'Description' : 'Reason for this correction (required)'} full>
          <textarea className="textarea" style={{ minHeight: 70 }} value={f.description} onChange={set('description')} placeholder={entry ? 'Short description for the timesheet' : 'e.g. Timer was left off; actual work was 2 h'} />
        </Field>
        {locked && canChangeTime && (
          <Field label={approved ? 'Reason for correction (required)' : 'Reason (needed to delete)'} full hint={approved ? 'This entry was approved. Your correction is recorded in the audit log.' : 'This entry was submitted for review. Only the owner can delete it, with a reason.'}>
            <input className="input" value={f.reason} onChange={set('reason')} />
          </Field>
        )}
      </div>
      {seconds >= 60 && <p className="small muted" style={{ marginTop: 12 }}>{entry ? 'The entry will be' : 'Will add'} <b>{fmtHM(seconds)}</b>{who ? ` for ${who.name.split(' ')[0]}` : ''}.</p>}
    </Modal>
  );
}

/** Create a task or subtask. */
export function TaskFormModal({ project, parent, members, selfOnly, me, trello, localLists = [], initialStage, initialStatus, onClose, onSaved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: '', description: '', assignee: '', people: selfOnly && !parent && me?.id ? [me.id] : [], priority: 'medium', deadline: '', estimate: null, status: initialStatus || 'todo', stageId: initialStage || '', labelIds: [], inTrello: null });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  // Subtasks are always internal. A top-level ticket on a Trello-linked project must be told where to live.
  const onLocalList = !!trello && !parent && localLists.some((l) => l.id === (f.stageId || trello.lists?.[0]?.id));
  const needsHomeChoice = !!trello && !parent && !onLocalList && f.inTrello === null;
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        title: f.title, description: f.description, priority: f.priority, status: f.status,
        ...(!parent ? { assignee: f.people[0] || null, collaborators: f.people.slice(1) } : { assignee: f.assignee || null }),
        deadline: f.deadline || null, ...(parent && !selfOnly ? { estimateSeconds: f.estimate } : {}),
        ...(!trello && !parent && f.stageId ? { stageId: f.stageId } : {}),
        ...(trello && !parent ? { stageId: f.stageId || trello.lists?.[0]?.id, labelIds: f.labelIds, inTrello: f.inTrello === true && !onLocalList } : {}),
      };
      const t = await api.post('/tasks', parent ? { ...body, parent: parent.id } : { ...body, project: project.id });
      if (parent) toast.success('Subtask added');
      else toast.success('Task created', 'Add subtasks to assign the work and track time.');
      onSaved?.(t);
      onClose();
    } catch (e) { toast.error('Could not create', e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={parent ? `New subtask · ${parent.title}` : 'New task'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !f.title.trim() || needsHomeChoice}>{busy ? 'Creating…' : 'Create'}</button></>}>
      <div className="form-grid">
        <Field label="Title" full><input className="input" autoFocus value={f.title} onChange={set('title')} placeholder="e.g. Integrate the authentication API" onKeyDown={(e) => e.key === 'Enter' && f.title.trim() && !needsHomeChoice && save()} /></Field>
        {selfOnly && parent ? (
          <Field label="Assignee" hint="Tasks you add yourself are assigned to you. A manager can reassign them.">
            <div className="row input" style={{ opacity: 0.9 }}>{me?.name} <span className="chip">you</span></div>
          </Field>
        ) : (
          parent ? (
            <Field label="Assignee" hint="A subtask has exactly one person. They are the one who tracks time on it.">
              <Select value={f.assignee} onChange={set('assignee')}><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            </Field>
          ) : (
            <Field label="Assigned to" hint="One or more team members. The first is the main assignee. Each person tracks time on their own subtask.">
              <PeoplePicker members={members} value={f.people} onChange={(v) => setF((x) => ({ ...x, people: v }))} />
            </Field>
          )
        )}
        <Field label="Priority"><Select value={f.priority} onChange={set('priority')}>{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</Select></Field>
        <Field label="Deadline"><input type="date" className="input" min={dateStr()} value={f.deadline} onChange={set('deadline')} /></Field>
        {parent && !selfOnly && (
          <Field label="Estimate" hint="Hours planned for this subtask. They are added to the task total automatically. Leave empty for no estimate.">
            <DurationInput value={f.estimate} onChange={(v) => setF((x) => ({ ...x, estimate: v }))} />
          </Field>
        )}
        {!trello && !parent && localLists.length > 0 && (
          <Field label="List" hint="A column on the board. “Status columns” means the normal To Do / In Progress / … columns.">
            <Select value={f.stageId || ''} onChange={set('stageId')}>
              <option value="">Status columns</option>
              {localLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        )}
        {trello && !parent && (
          <>
            <Field label="List" hint={localLists.some((l) => l.id === (f.stageId || trello.lists?.[0]?.id)) ? 'Chronos-only list: no Trello card is created.' : 'The card is created in this list on the Trello board.'}>
              <Select value={f.stageId || trello.lists?.[0]?.id || ''} onChange={set('stageId')}>
                {localLists.length > 0 && <optgroup label="Trello lists">{(trello.lists || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>}
                {localLists.length === 0 && (trello.lists || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                {localLists.length > 0 && <optgroup label="Chronos only">{localLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>}
              </Select>
            </Field>
            <Field label="Labels"><LabelPicker projectId={project.id} labels={trello.labels} value={f.labelIds} onChange={(v) => setF((x) => ({ ...x, labelIds: v }))} /></Field>
          </>
        )}
        {trello && !parent && (
          <Field label="Where should this ticket live?" full hint={onLocalList ? 'This is a Chronos-only list, so the ticket stays internal.' : f.inTrello === true ? 'A card is created on the Trello board and stays connected to it.' : f.inTrello === false ? 'The ticket stays in Chronos only. Nothing about it is sent to Trello unless you choose “Add to Trello” later.' : 'Choose one to continue.'}>
            <div className="row wrap" style={{ gap: 16 }}>
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name="ticket-home" checked={!onLocalList && f.inTrello === true} disabled={onLocalList} onChange={() => setF((x) => ({ ...x, inTrello: true }))} /> Create in Trello (connected)
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name="ticket-home" checked={onLocalList || f.inTrello === false} onChange={() => setF((x) => ({ ...x, inTrello: false }))} /> Internal only
              </label>
            </div>
          </Field>
        )}
        {!parent && <Field label="Description" full><textarea className="textarea" value={f.description} onChange={set('description')} placeholder="What needs to be delivered?" /></Field>}
      </div>
    </Modal>
  );
}

/** Opens the task drawer by adding ?task=<id> to the current URL. */
export function useOpenTask() {
  const [params, setParams] = useSearchParams();
  return (id) => { const p = new URLSearchParams(params); p.set('task', id); setParams(p); };
}

export const OverdueChip =() => <span className="chip danger"><AlertTriangle size={11} /> Overdue</span>;
export { toInputDate };
