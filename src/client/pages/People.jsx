import { useState } from 'react';
import { UserPlus, KeyRound, Search, Copy, Pencil } from 'lucide-react';
import { api } from '../api';
import { useAuth, useConfirm, useToast } from '../context';
import { Avatar, Badge, ErrorState, Field, Modal, Select, Skeleton, useFetch } from '../ui';
import { ROLE_LABEL } from '../format';

// Only these roles can be handed out. (The owner is the admin account; the read-only viewer role is not offered.)
const ASSIGNABLE = ['manager', 'employee'];
const roleOptions = (current) => Object.entries(ROLE_LABEL).filter(([k]) => ASSIGNABLE.includes(k) || k === current);

const ROLE_COLOR = { owner: 'var(--primary-2)', manager: 'var(--primary)', employee: 'var(--success)', viewer: 'var(--text-3)' };

const genPassword = () => `Chr-${Math.random().toString(36).slice(2, 8)}-${Math.floor(Math.random() * 90 + 10)}`;

/** Admin creates the account and sets the password. Afterwards the credentials are shown once, to hand over in person. */
function UserModal({ onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', role: 'employee', password: genPassword() });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try { await api.post('/users', f); setDone(f); onSaved(); } catch (e) { toast.error('Could not create account', e.message); } finally { setBusy(false); }
  };
  const copy = () => navigator.clipboard?.writeText(`Email: ${done.email}
Password: ${done.password}`).then(() => toast.success('Copied'), () => {});
  if (done) {
    return (
      <Modal title="Account ready" onClose={onClose} footer={<><button className="btn" onClick={copy}><Copy size={15} /> Copy</button><button className="btn primary" onClick={onClose}>Done</button></>}>
        <div className="stack">
          <p className="muted">Tell <b>{done.name.split(' ')[0]}</b> these sign-in details in person. This password will not be shown again.</p>
          <div className="callout" style={{ display: 'block' }}>
            <div className="xs faint">Email</div><b>{done.email}</b>
            <div className="xs faint" style={{ marginTop: 10 }}>Password</div><b style={{ fontFamily: 'monospace', fontSize: 16 }}>{done.password}</b>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Add employee" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim() || !f.email.trim() || f.password.length < 8} onClick={save}>Create account</button></>}>
      <div className="form-grid">
        <Field label="Full name"><input className="input" autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Work email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Role"><Select value={f.role} onChange={set('role')}>{roleOptions(f.role).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Password" hint="At least 8 characters. You will give this to the employee in person.">
          <div className="row"><input className="input" value={f.password} onChange={set('password')} /><button type="button" className="btn" onClick={() => setF((x) => ({ ...x, password: genPassword() }))}><KeyRound size={15} /> New</button></div>
        </Field>
      </div>
    </Modal>
  );
}

/** Edit a person's details. The email is their login and cannot be changed. */
function EditModal({ u, isMe, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: u.name, role: u.role, password: '', trello: u.trelloMemberId || '' });
  const [busy, setBusy] = useState(false);
  const { data: trelloMembers } = useFetch(() => api.get('/users/trello-members').catch(() => []), []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    const body = { name: f.name.trim() };
    if (!isMe) body.role = f.role;
    if (f.password) body.password = f.password;
    if (f.trello !== (u.trelloMemberId || '')) body.trelloMemberId = f.trello || null;
    try { await api.patch(`/users/${u.id}`, body); toast.success('Saved', f.password ? `New password: ${f.password}` : undefined); onSaved(); onClose(); } catch (e) { toast.error('Could not save', e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Edit employee" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name.trim() || (f.password && f.password.length < 8)} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Full name"><input className="input" autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Work email" hint="Email is their login and can't be changed."><input className="input" value={u.email} disabled readOnly /></Field>
        {!isMe && <Field label="Role"><Select value={f.role} onChange={set('role')}>{roleOptions(u.role).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
        <Field label="Trello account" hint="Link this person to their Trello account so that assigning them here also assigns them on the Trello card.">
          <Select value={f.trello} onChange={set('trello')}>
            <option value="">Not linked</option>
            {(trelloMembers || []).map((m) => <option key={m.id} value={m.id}>{m.fullName || m.username}{m.username ? ` (@${m.username})` : ''}</option>)}
            {f.trello && !(trelloMembers || []).some((m) => m.id === f.trello) && <option value={f.trello}>Linked Trello account</option>}
          </Select>
        </Field>
        {!isMe && <Field label="New password" hint="Leave empty to keep the current password. Otherwise at least 8 characters.">
          <div className="row"><input className="input" value={f.password} onChange={set('password')} placeholder="Unchanged" /><button type="button" className="btn" onClick={() => setF((x) => ({ ...x, password: genPassword() }))}><KeyRound size={15} /> New</button></div>
        </Field>}
      </div>
    </Modal>
  );
}

/** Approve someone found on Trello: Trello hides emails, so the admin types the work email and a password. Until then they cannot sign in. */
function ApproveModal({ u, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ email: u.email.endsWith('@trello.invalid') ? '' : u.email, password: genPassword() });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) && f.password.length >= 8;
  const save = async () => {
    setBusy(true);
    try { await api.post(`/users/${u.id}/approve`, { role: 'employee', email: f.email, password: f.password }); setDone(true); onDone(); } catch (e) { toast.error('Could not approve', e.message); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal title="Approved" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <div className="stack">
          <p className="muted">Tell <b>{u.name.split(' ')[0]}</b> these sign-in details in person. The password is not shown again.</p>
          <div className="callout" style={{ display: 'block' }}>
            <div className="xs faint">Email</div><b>{f.email}</b>
            <div className="xs faint" style={{ marginTop: 10 }}>Password</div><b style={{ fontFamily: 'monospace', fontSize: 16 }}>{f.password}</b>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Approve ${u.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !valid} onClick={save}>Approve</button></>}>
      <div className="form-grid">
        <Field label="Work email" hint="Trello doesn't share email addresses. This is what they sign in with."><input className="input" type="email" autoFocus value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} /></Field>
        <Field label="Password" hint="At least 8 characters. Give it to them in person.">
          <div className="row"><input className="input" value={f.password} onChange={(e) => setF((x) => ({ ...x, password: e.target.value }))} /><button type="button" className="btn" onClick={() => setF((x) => ({ ...x, password: genPassword() }))}><KeyRound size={15} /> New</button></div>
        </Field>
      </div>
    </Modal>
  );
}

export default function People() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, reload } = useFetch(() => api.get('/users'), []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const update = async (u, body, msg) => {
    try { await api.patch(`/users/${u.id}`, body); toast.success(msg); reload(); } catch (e) { toast.error('Could not update', e.message); }
  };
  if (error && !data) return <div className="page"><ErrorState error={error} retry={reload} /></div>;
  const [approving, setApproving] = useState(null);
  const ignore = async (u) => {
    if (!(await confirm({ title: `Ignore ${u.name}?`, message: 'They stay on the Trello board but are not given a Chronos login. This list will not show them again.', confirmLabel: 'Ignore' }))) return;
    try { await api.post(`/users/${u.id}/ignore`); reload(); } catch (e) { toast.error('Could not ignore', e.message); }
  };
  // People found on Trello (waiting for approval) sit in the same list as everyone else; other leftover requests stay hidden
  const list = (data || []).filter((u) => (!u.pending || (u.trelloMemberId && !u.trelloIgnored)) && (u.name + u.email).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>People</h1><p>Add people and set their password. They sign in with the email and password you give them.</p></div>
        <button className="btn primary" onClick={() => setOpen(true)}><UserPlus size={16} /> Add employee</button>
      </div>
      <div className="search" style={{ width: 300, marginBottom: 16 }}><Search size={16} /><input className="input" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!data ? <Skeleton h={300} /> : (
        <div className="card" style={{ padding: 8 }}><div className="table-wrap"><table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>{list.map((u) => (
            <tr key={u.id} style={{ opacity: u.active || u.pending ? 1 : 0.55 }}>
              <td><div className="row"><Avatar user={u} size={38} /><div><b>{u.name}</b>{u.id === me.id && <span className="chip" style={{ marginLeft: 8 }}>You</span>}<div className="xs faint">{u.pending ? 'Found on Trello · no login yet' : `${u.email} · ${u.title || '—'}`}</div></div></div></td>
              <td><Badge color={ROLE_COLOR[u.role]}>{ROLE_LABEL[u.role]}</Badge></td>
              <td>{u.pending ? <Badge color="var(--warn)">Awaiting approval</Badge> : <Badge color={u.active ? 'var(--success)' : 'var(--text-3)'}>{u.active ? 'Active' : 'Deactivated'}</Badge>}</td>
              <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                {u.pending ? (<><button className="btn sm danger" onClick={() => ignore(u)}>Ignore</button><button className="btn sm success" onClick={() => setApproving(u)}>Approve</button></>) : <button className="btn sm" onClick={() => setEditing(u)}><Pencil size={13} /> Edit</button>}
                {!u.pending && u.id !== me.id && <button className={`btn sm ${u.active ? 'danger' : ''}`} onClick={() => update(u, { active: !u.active }, u.active ? `${u.name.split(' ')[0]} deactivated` : `${u.name.split(' ')[0]} reactivated`)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}
              </div></td>
            </tr>
          ))}</tbody></table></div></div>
      )}
      {approving && <ApproveModal u={approving} onClose={() => setApproving(null)} onDone={reload} />}
      {editing && <EditModal u={editing} isMe={editing.id === me.id} onClose={() => setEditing(null)} onSaved={reload} />}
      {open && <UserModal onClose={() => setOpen(false)} onSaved={reload} />}
    </div>
  );
}
