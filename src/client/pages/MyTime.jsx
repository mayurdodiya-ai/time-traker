import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Send, Pencil, Trash2, Clock, AlertTriangle, MessageSquareWarning, Zap, PenLine } from 'lucide-react';
import { api, qs } from '../api';
import { useConfirm, useTimer, useToast } from '../context';
import { ApprovalBadge, Empty, ErrorState, Skeleton, useFetch } from '../ui';
import { TimeEntryModal, useOpenTask } from '../components';
import { APPROVAL, addDaysStr, dateStr, fmtDay, fmtHM, weekStart } from '../format';

export default function MyTime() {
  const toast = useToast();
  const confirm = useConfirm();
  const { version, bump } = useTimer();
  const open = useOpenTask();
  const [ws, setWs] = useState(weekStart());
  const we = addDaysStr(ws, 6);
  const [day, setDay] = useState(null);
  const [modal, setModal] = useState(null); // {entry?} | {}
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useFetch(() => api.get(`/time-entries${qs({ mine: 1, from: ws, to: we })}`), [ws, version]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(ws, i)), [ws]);
  const entries = data?.entries || [];
  const byDay = useMemo(() => Object.fromEntries(days.map((d) => [d, entries.filter((e) => e.workDate === d)])), [days, entries]);
  const secs = (d) => byDay[d].reduce((s, e) => s + e.durationSeconds, 0);
  const maxDay = Math.max(8 * 3600, ...days.map(secs));
  const shown = (day ? [day] : [...days].reverse()).filter((d) => byDay[d].length);
  const sum = (st) => entries.filter((e) => st.includes(e.approvalStatus)).reduce((s, e) => s + e.durationSeconds, 0);
  const submittable = entries.filter((e) => ['draft', 'rejected'].includes(e.approvalStatus));
  const today = dateStr();
  const rejected = entries.filter((e) => e.approvalStatus === 'rejected');

  const submit = async () => {
    if (!(await confirm({ title: 'Submit timesheet for review?', message: `${submittable.length} entries (${fmtHM(submittable.reduce((s, e) => s + e.durationSeconds, 0))}) will be sent to your approver. You won’t be able to edit them while they’re under review.`, confirmLabel: 'Submit' }))) return;
    setBusy(true);
    try { const r = await api.post('/time-entries/submit', { ids: submittable.map((e) => e.id) }); toast.success(`Submitted ${r.submitted} entries`, 'Your approver has been notified.'); bump(); reload(); } catch (e) { toast.error('Could not submit', e.message); } finally { setBusy(false); }
  };
  const del = async (e) => {
    if (!(await confirm({ title: 'Delete time entry?', message: `${fmtHM(e.durationSeconds)} on “${e.task.title}” will be removed.`, danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/time-entries/${e.id}`); toast.success('Entry deleted'); bump(); reload(); } catch (x) { toast.error('Cannot delete', x.message); }
  };

  if (error && !data) return <div className="page"><ErrorState error={error} retry={reload} /></div>;
  const range = `${fmtDay(ws).replace(/^\w+, /, '')} – ${fmtDay(we).replace(/^\w+, /, '')}`;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>My Time</h1><p>Your timesheet — time recorded by the timer.</p></div>
        <div className="row wrap">
          <button className="btn primary" disabled={!submittable.length || busy} onClick={submit}><Send size={16} /> Submit week{submittable.length ? ` (${submittable.length})` : ''}</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row between wrap" style={{ marginBottom: 16 }}>
          <div className="row">
            <button className="btn icon sm" onClick={() => { setWs(addDaysStr(ws, -7)); setDay(null); }} aria-label="Previous week"><ChevronLeft size={17} /></button>
            <b style={{ minWidth: 150, textAlign: 'center' }}>{range}</b>
            <button className="btn icon sm" onClick={() => { setWs(addDaysStr(ws, 7)); setDay(null); }} disabled={ws >= weekStart()} aria-label="Next week"><ChevronRight size={17} /></button>
            {ws !== weekStart() && <button className="btn ghost sm" onClick={() => { setWs(weekStart()); setDay(null); }}>This week</button>}
          </div>
          <div className="row wrap" style={{ gap: 18 }}>
            <div><div className="xs faint">Week total</div><b className="tnum" style={{ fontSize: 22 }}>{fmtHM(data?.totalSeconds ?? 0)}</b></div>
            {['draft', 'submitted', 'approved'].map((k) => <div key={k}><div className="xs faint">{APPROVAL[k].label}</div><b className="tnum" style={{ color: APPROVAL[k].color }}>{fmtHM(sum([k]))}</b></div>)}
          </div>
        </div>
        <div className="week-strip">
          {days.map((d) => (
            <button key={d} className={`day-cell ${day === d ? 'on' : ''} ${d === today ? 'today' : ''}`} onClick={() => setDay(day === d ? null : d)}>
              <small>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${d}T12:00:00`))}</small>
              <b>{Number(d.slice(8))}</b>
              <span>{secs(d) ? fmtHM(secs(d)) : '—'}</span>
              <div className="mini"><i style={{ width: `${(secs(d) / maxDay) * 100}%` }} /></div>
            </button>
          ))}
        </div>
      </div>

      {rejected.length > 0 && (
        <div className="callout warn" style={{ marginBottom: 18 }}>
          <MessageSquareWarning size={19} style={{ flex: 'none', marginTop: 1 }} />
          <div><b>{rejected.length} entr{rejected.length > 1 ? 'ies were' : 'y was'} sent back for correction.</b> Edit {rejected.length > 1 ? 'them' : 'it'} and re-submit — reviewer notes are shown on each entry.</div>
        </div>
      )}

      {!data ? <div className="stack"><Skeleton h={70} /><Skeleton h={70} /><Skeleton h={70} /></div> : shown.length === 0 ? (
        <div className="card"><Empty icon={Clock} title={day ? 'Nothing tracked on this day' : 'No time tracked this week'}>Start the timer on one of your subtasks to record time.</Empty></div>
      ) : shown.map((d) => (
        <div key={d}>
          <div className="day-head"><b>{d === today ? 'Today' : fmtDay(d)}</b><span className="muted small tnum">{fmtHM(secs(d))} · {byDay[d].length} entr{byDay[d].length > 1 ? 'ies' : 'y'}</span></div>
          {byDay[d].map((e) => {
            const editable = ['draft', 'rejected'].includes(e.approvalStatus);
            return (
              <div key={e.id}>
                <div className="entry" style={{ '--pc': e.project.color }}>
                  <div className="bar" />
                  <div className="grow" style={{ cursor: 'pointer' }} onClick={() => open(e.task.id)}>
                    <div className="row" style={{ gap: 8 }}><b className="ellipsis">{e.task.parent && <span className="faint">{e.task.parent.title} › </span>}{e.task.title}</b></div>
                    <div className="row xs faint wrap" style={{ gap: 8, marginTop: 2 }}>
                      <span>{e.project.name}</span>
                      <span className="chip">{e.source === 'timer' ? <><Zap size={10} /> timer</> : <><PenLine size={10} /> manual</>}</span>
                      {e.overlap && <span className="chip warn"><AlertTriangle size={10} /> overlaps another entry</span>}
                      {e.description && <span className="muted ellipsis" style={{ maxWidth: 360 }}>· {e.description}</span>}
                    </div>
                  </div>
                  <ApprovalBadge status={e.approvalStatus} />
                  <b className="tnum" style={{ minWidth: 70, textAlign: 'right', fontSize: 15 }}>{fmtHM(e.durationSeconds)}</b>
                  <div className="row" style={{ gap: 2, width: 66, justifyContent: 'flex-end' }}>
                    {editable && <><button className="btn ghost icon sm" onClick={() => setModal({ entry: e })} aria-label="Edit"><Pencil size={15} /></button></>}
                  </div>
                </div>
                {e.approvalStatus === 'rejected' && e.reviewNote && <div className="callout danger small" style={{ margin: '-2px 0 10px 18px' }}><b>Reviewer:</b> {e.reviewNote}</div>}
              </div>
            );
          })}
        </div>
      ))}

      {modal && <TimeEntryModal entry={modal.entry} onClose={() => setModal(null)} onSaved={() => { bump(); reload(); }} />}
    </div>
  );
}
