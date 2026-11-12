import { useState } from 'react';
import { Timer, ShieldCheck, Zap, BarChart3, Eye, EyeOff, ArrowRight, Play } from 'lucide-react';
import { useAuth, useTheme } from '../context';

export default function Login() {
  const { login } = useAuth();
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try { await login(email, password); } catch (x) { setErr(x.message); setBusy(false); }
  };

  return (
    <div className="auth" data-theme={theme}>
      <section className="auth-hero">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark" style={{ background: 'rgba(255,255,255,.18)', backdropFilter: 'blur(10px)' }}><Timer size={21} strokeWidth={2.6} /></div>
          <div><b style={{ color: '#fff' }}>Time Tracker</b></div>
        </div>

        <div>
          <h1>Know where every<br /><em>working hour</em> goes.</h1>
          <p>One calm place for projects, tasks and subtasks — with timers you can trust, on web and mobile.</p>
          <div className="stack" style={{ marginTop: 28, gap: 14, color: 'rgba(255,255,255,.88)' }}>
            {[[Zap, 'One-tap timers. Start a new one and the last pauses itself.'], [BarChart3, 'Estimate vs. actual, per task, project and person.'], [ShieldCheck, 'Role-based access with a full audit trail.']].map(([I, t]) => (
              <div key={t} className="row"><span className="glass-mock" style={{ padding: 8, borderRadius: 12, display: 'grid' }}><I size={17} /></span><span>{t}</span></div>
            ))}
          </div>
        </div>

        <div className="mock-stack" aria-hidden="true">
          <div className="glass-mock m1">
            <div className="row" style={{ gap: 12 }}>
              <span className="dot pulse" />
              <b style={{ fontSize: 26, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>01:24:07</b>
              <span className="right" style={{ background: 'rgba(255,255,255,.2)', borderRadius: 99, padding: 7, display: 'grid' }}><Play size={14} fill="#fff" /></span>
            </div>
            <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 4 }}>Integrate the authentication API</div>
          </div>
          <div className="glass-mock m2">
            <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '.08em' }}>This week</div>
            <b style={{ fontSize: 24 }}>32 h 40 m</b>
            <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 38, marginTop: 6 }}>
              {[40, 70, 55, 90, 62, 30, 15].map((h, i) => <i key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 4, background: '#b4c0ff' }} />)}
            </div>
          </div>
          <div className="glass-mock m3">
            <div className="row between" style={{ fontSize: 12.5 }}><span>Website Redesign</span><b>68%</b></div>
            <div className="progress" style={{ marginTop: 8, background: 'rgba(255,255,255,.2)' }}><span style={{ width: '68%', background: '#b4c0ff' }} /></div>
          </div>
        </div>
      </section>

      <section className="auth-form">
        <div className="auth-card stack" style={{ gap: 22 }}>
          <div>
            <h2>Welcome back</h2>
            <p className="muted" style={{ marginTop: 6 }}>Sign in with the email and password your administrator gave you.</p>
          </div>
          <form className="stack" onSubmit={submit}>
            <div className="field"><label htmlFor="em">Work email</label><input id="em" className="input" type="email" autoComplete="username" required placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><label htmlFor="pw">Password</label>
              <div style={{ position: 'relative' }}>
                <input id="pw" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 44 }} />
                <button type="button" className="btn ghost icon sm" style={{ position: 'absolute', right: 6, top: 5 }} onClick={() => setShow(!show)} aria-label="Show password">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
            {err && <div className="callout danger" role="alert">{err}</div>}
            <button className="btn primary" style={{ padding: '12px 16px', fontSize: 15 }} disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ArrowRight size={17} /></>}</button>
          </form>
        </div>
      </section>
    </div>
  );
}
