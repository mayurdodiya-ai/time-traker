import { useMemo, useState } from 'react';
import { Check, X, ShieldCheck, Zap, PenLine, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { useConfirm, useTimer, useToast } from '../context';
import { Avatar, ApprovalBadge, Empty, ErrorState, Modal, Skeleton, useFetch } from '../ui';
import { useOpenTask } from '../components';
import { fmtDay, fmtHM } from '../format';

export default function Approvals() {
  const toast = useToast();
  const { bump, version } = useTimer();
  const open = useOpenTask();
  const [status, setStatus] = useState('submitted');
  const { data, error, reload } = useFetch(() => api.get(`/time-entries/approvals/queue?status=${status}`), [status, version]);
  const [sel, setSel] = useState(new Set());
  const [reject, setReject] = useState(null); // array of ids
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const entries = data?.entries || [];
  const groups = useMemo(() => {
    const g = new Map();
    entries.forEach((e) => { if (!g.has(e.user.id)) g.set(e.user.id, { user: e.user, items: [] }); g.get(e.user.id).items.push(e); });
    return [...g.values()];
  }, [entries]);

  const toggle = (ids, on) => setSel((s) => { const n = new Set(s); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const review = async (ids, decision, noteText = '') => {
    setBusy(true);
    try {
      const r = await api.post('/time-entries/approvals/review', { ids, decision, note: noteText });
      toast.success(`${r.reviewed} entr${r.reviewed > 1 ? 'ies' : 'y'} ${decision}`, 'The employee has been notified.');
      setSel(new Set()); setReject(null); setNote(''); bump(); reload();
    } catch (e) { toast.error('Review failed', e.message); } finally { setBusy(false); }
  };

  if (error && !data) return <div className="page"><ErrorState error={error} retry={reload} /></div>;
  const selSecs = entries.filter((e) => sel.has(e.id)).reduce((s, e) => s + e.durationSeconds, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Approval queue</h1><p>Review submitted time. Approved entries are locked — later changes need an audited correction.</p></div>
        <div className="tabs">{[['submitted', 'Pending'], ['approved', 'Approved'], ['rejected', 'Sent back']].map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); setSel(new Set()); }}>{l}</button>)}</div>
      </div>

      {!data ? <div className="stack"><Skeleton h={120} /><Skeleton h={120} /></div> : groups.length === 0 ? (
        <div className="card"><Empty icon={ShieldCheck} title={status === 'submitted' ? 'Nothing waiting for review' : 'No entries here'}>{status === 'submitted' ? 'You’re all caught up. New submissions will appear here.' : 'Entries will show up as they are reviewed.'}</Empty></div>
      ) : groups.map(({ user, items }) => {
        const ids = items.map((i) => i.id);
        const allOn = ids.every((i) => sel.has(i));
        const total = items.reduce((s, e) => s + e.durationSeconds, 0);
        return (
          <div key={user.id} className="card" style={{ marginBottom: 18, padding: 0, overflow: 'hidden' }}>
            <div className="row between wrap" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div className="row">
                {status === 'submitted' && <button className={`check ${allOn ? 'on' : ''}`} onClick={() => toggle(ids, !allOn)} aria-label="Select all"><Check size={13} strokeWidth={3} /></button>}
                <Avatar user={user} size={38} /><div><b>{user.name}</b><div className="xs faint">{items.length} entries · {fmtHM(total)}</div></div>
              </div>
              {status === 'submitted' && <div className="row"><button className="btn danger sm" onClick={() => setReject(ids)}><X size={14} /> Send back</button><button className="btn success sm" disabled={busy} onClick={() => review(ids, 'approved')}><Check size={14} /> Approve all</button></div>}
            </div>
            <div style={{ padding: '6px 12px 10px' }}>
              {items.map((e) => (
                <div key={e.id} className="task-row" style={{ cursor: 'default' }}>
                  {status === 'submitted' && <button className={`check ${sel.has(e.id) ? 'on' : ''}`} onClick={() => toggle([e.id], !sel.has(e.id))} aria-label="Select"><Check size={13} strokeWidth={3} /></button>}
                  <span className="dot" style={{ '--c': e.project.color }} />
                  <div className="grow" onClick={() => open(e.task.id)} style={{ cursor: 'pointer' }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>{e.task.parent && <span className="faint">{e.task.parent.title} › </span>}{e.task.title}</div>
                    <div className="xs faint row wrap" style={{ gap: 8 }}>{e.project.name} · {fmtDay(e.workDate)}
                      <span className="chip">{e.source === 'timer' ? <><Zap size={10} /> timer</> : <><PenLine size={10} /> manual</>}</span>
                      {e.overlap && <span className="chip warn"><AlertTriangle size={10} /> overlap</span>}
                      {e.description && <span className="muted">· {e.description}</span>}</div>
                    {e.reviewNote && <div className="xs" style={{ color: 'var(--danger)', marginTop: 2 }}>Note: {e.reviewNote}</div>}
                  </div>
                  <ApprovalBadge status={e.approvalStatus} />
                  <b className="tnum" style={{ minWidth: 64, textAlign: 'right' }}>{fmtHM(e.durationSeconds)}</b>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {sel.size > 0 && (
        <div className="dock" style={{ bottom: 22 }}>
          <div className="dock-inner">
            <b>{sel.size} selected</b><span className="muted small">{fmtHM(selSecs)}</span><div className="grow" />
            <button className="btn" onClick={() => setSel(new Set())}>Clear</button>
            <button className="btn danger" onClick={() => setReject([...sel])}><X size={15} /> Send back</button>
            <button className="btn success" disabled={busy} onClick={() => review([...sel], 'approved')}><Check size={15} /> Approve</button>
          </div>
        </div>
      )}

      {reject && (
        <Modal title="Send entries back for correction" onClose={() => setReject(null)}
          footer={<><button className="btn" onClick={() => setReject(null)}>Cancel</button><button className="btn danger" disabled={!note.trim() || busy} onClick={() => review(reject, 'rejected', note)}>Send back</button></>}>
          <p className="muted small" style={{ marginBottom: 12 }}>{reject.length} entr{reject.length > 1 ? 'ies' : 'y'} will return to the employee as editable. Explain what needs fixing.</p>
          <textarea className="textarea" autoFocus placeholder="e.g. Please add a description of the work done." value={note} onChange={(e) => setNote(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
