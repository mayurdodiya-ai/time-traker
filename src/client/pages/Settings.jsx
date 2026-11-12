import { useState } from 'react';
import { KeyRound, Palette, Sun, Moon, Globe } from 'lucide-react';
import { api } from '../api';
import { useAuth, useTheme, useToast } from '../context';
import { Avatar, Field } from '../ui';
import { ROLE_LABEL } from '../format';

export default function Settings() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const [p, setP] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const mismatch = p.confirm && p.next !== p.confirm;
  const save = async () => {
    setBusy(true);
    try { await api.post('/auth/password', { current: p.current, next: p.next }); toast.success('Password changed'); setP({ current: '', next: '', confirm: '' }); } catch (e) { toast.error('Could not change password', e.message); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p>Your profile and preferences.</p></div></div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 18 }}>
          <div className="card">
            <div className="row" style={{ gap: 16 }}>
              <Avatar user={user} size={64} />
              <div><h2 style={{ fontSize: 20 }}>{user.name}</h2><div className="muted">{user.email}</div><div className="row" style={{ marginTop: 8 }}><span className="chip">{ROLE_LABEL[user.role]}</span></div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-title"><h3><Palette size={16} style={{ verticalAlign: -3 }} /> Appearance</h3></div>
            <div className="row">
              <button className={`btn ${theme === 'dark' ? 'primary' : ''}`} onClick={() => theme !== 'dark' && toggle()}><Moon size={16} /> Dark</button>
              <button className={`btn ${theme === 'light' ? 'primary' : ''}`} onClick={() => theme !== 'light' && toggle()}><Sun size={16} /> Light</button>
            </div>
          </div>
          <div className="card">
            <div className="card-title"><h3><Globe size={16} style={{ verticalAlign: -3 }} /> Time &amp; dates</h3></div>
            <p className="small muted">Timestamps are stored in UTC and shown in your browser’s timezone (<b>{Intl.DateTimeFormat().resolvedOptions().timeZone}</b>). Work dates for timesheets follow the company timezone configured on the server. Durations are stored in whole seconds and displayed rounded to the nearest minute.</p>
          </div>
        </div>
        <div className="card">
          <div className="card-title"><h3><KeyRound size={16} style={{ verticalAlign: -3 }} /> Change password</h3></div>
          <div className="stack">
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={p.current} onChange={(e) => setP({ ...p, current: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters"><input className="input" type="password" autoComplete="new-password" value={p.next} onChange={(e) => setP({ ...p, next: e.target.value })} /></Field>
            <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" value={p.confirm} onChange={(e) => setP({ ...p, confirm: e.target.value })} />{mismatch && <span className="hint" style={{ color: 'var(--danger)' }}>Passwords don’t match</span>}</Field>
            <button className="btn primary" disabled={busy || !p.current || p.next.length < 8 || p.next !== p.confirm} onClick={save}>Update password</button>
          </div>
          <hr className="sep" />
          <button className="btn danger" onClick={logout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
