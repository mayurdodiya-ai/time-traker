import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { invalidateTaskCache } from './taskCache';
import { CheckCircle2, AlertTriangle, Info, XCircle, PauseCircle } from 'lucide-react';
import { api, tokenStore } from './api';
import { fmtHM } from './format';
import { Modal } from './ui';

/* ---------------------------------------------------------------- theme */
const ThemeCtx = createContext();
export const useTheme = () => useContext(ThemeCtx);
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('chronos_theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('chronos_theme', theme); } catch { /* private mode */ }
  }, [theme]);
  const value = useMemo(() => ({ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }), [theme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

/* ---------------------------------------------------------------- toasts + confirm */
const ToastCtx = createContext();
export const useToast = () => useContext(ToastCtx).toast;
export const useConfirm = () => useContext(ToastCtx).confirm;

const TOAST_ICON = { success: CheckCircle2, error: XCircle, warn: AlertTriangle, info: Info, pause: PauseCircle };
const TOAST_COLOR = { success: 'var(--success)', error: 'var(--danger)', warn: 'var(--warn)', info: 'var(--primary)', pause: 'var(--warn)' };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const [dialog, setDialog] = useState(null);
  const id = useRef(0);
  const toast = useCallback((title, { message = '', type = 'info', ms = 4200 } = {}) => {
    const n = ++id.current;
    // Repeating the same action (e.g. dragging the same card three times) must not stack three identical messages: show it once,
    // and restart its timer so it stays long enough to read.
    setItems((x) => (x.some((i) => i.title === title && i.message === message && i.type === type)
      ? x.map((i) => (i.title === title && i.message === message && i.type === type ? { ...i, n } : i))
      : [...x, { n, title, message, type }]));
    setTimeout(() => setItems((x) => x.filter((i) => i.n !== n)), ms);
  }, []);
  toast.success = (t, m) => toast(t, { message: m, type: 'success' });
  toast.error = (t, m) => toast(t, { message: m, type: 'error', ms: 6500 });
  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  const close = (v) => { dialog.resolve(v); setDialog(null); setReason(''); };
  const [reason, setReason] = useState('');
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = TOAST_ICON[t.type];
          return (
            <div key={t.n} className="toast" style={{ '--c': TOAST_COLOR[t.type] }}>
              <Icon size={19} className="t-ico" />
              <div><b>{t.title}</b>{t.message && <span>{t.message}</span>}</div>
            </div>
          );
        })}
      </div>
      {dialog && (
        <Modal title={dialog.title} onClose={() => close(false)}>
          <p className="muted">{dialog.message}</p>
          {dialog.input && <textarea className="textarea" style={{ marginTop: 14 }} autoFocus placeholder={dialog.placeholder} value={reason} onChange={(e) => setReason(e.target.value)} />}
          <div className="modal-foot" style={{ padding: '22px 0 4px' }}>
            <button className="btn" onClick={() => close(false)}>Cancel</button>
            <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} disabled={dialog.input && !reason.trim()} onClick={() => close(dialog.input ? reason.trim() : true)}>{dialog.confirmLabel || 'Confirm'}</button>
          </div>
        </Modal>
      )}
    </ToastCtx.Provider>
  );
}

/* ---------------------------------------------------------------- auth */
const AuthCtx = createContext();
export const useAuth = () => useContext(AuthCtx);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('chronos:signout', out);
    if (!tokenStore.get()) { setReady(true); return () => window.removeEventListener('chronos:signout', out); }
    api.get('/auth/me').then((r) => setUser(r.user)).catch(() => tokenStore.clear()).finally(() => setReady(true));
    return () => window.removeEventListener('chronos:signout', out);
  }, []);

  const value = useMemo(() => ({
    user, ready,
    can: {
      manage: user && ['owner', 'manager'].includes(user.role),
      owner: user?.role === 'owner',
      review: user?.role === 'owner', // only the admin approves time
      track: user && user.role !== 'viewer',
    },
    async login(email, password) {
      const r = await api.post('/auth/login', { email, password });
      tokenStore.set(r.token);
      setUser(r.user);
    },
    logout() { tokenStore.clear(); setUser(null); },
  }), [user, ready]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/* ---------------------------------------------------------------- timer (server is the source of truth) */
const TimerCtx = createContext();
export const useTimer = () => useContext(TimerCtx);

export function TimerProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const [sessions, setSessions] = useState([]);
  const [version, setVersion] = useState(0); // bumped when time data changes so pages can refetch
  const [busy, setBusy] = useState(false);
  const offset = useRef(0); // serverTime - clientTime, so the display never trusts the device clock

  const apply = useCallback((snap) => {
    offset.current = new Date(snap.serverNow).getTime() - Date.now();
    setSessions(snap.sessions);
  }, []);
  const sync = useCallback(() => api.get('/timer').then(apply).catch(() => {}), [apply]);

  useEffect(() => {
    if (!user) { setSessions([]); return undefined; }
    sync();
    const i = setInterval(sync, 30000); // picks up changes made from another device
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    return () => { clearInterval(i); window.removeEventListener('focus', sync); window.removeEventListener('online', sync); };
  }, [user?.id, sync]);

  const run = useCallback(async (fn) => {
    setBusy(true);
    try { return await fn(); } catch (e) { toast.error('Timer action failed', e.message); return null; } finally { setBusy(false); }
  }, [toast]);

  const value = useMemo(() => {
    const running = sessions.find((s) => s.state === 'running') || null;
    const paused = sessions.filter((s) => s.state === 'paused');
    return {
      sessions, running, paused, busy, version,
      elapsedOf: (s, now = Date.now()) => s.accumulatedSeconds + (s.state === 'running' ? Math.max(0, (now + offset.current - new Date(s.segmentStart).getTime()) / 1000) : 0),
      sessionFor: (taskId) => sessions.find((s) => s.task?.id === taskId) || null,
      bump: () => { invalidateTaskCache(); setVersion((v) => v + 1); },
      start: (taskId, description) => run(async () => {
        const snap = await api.post('/timer/start', { taskId, description });
        apply(snap);
        if (snap.pausedPrevious) toast('Previous timer paused', { type: 'pause', message: `“${snap.pausedPrevious.title}” was paused automatically. Only one timer can run at a time.` });
        setVersion((v) => v + 1);
        return snap;
      }),
      pause: () => run(async () => { apply(await api.post('/timer/pause')); setVersion((v) => v + 1); }),
      stop: (taskId, description) => run(async () => {
        const snap = await api.post('/timer/stop', { taskId, description });
        apply(snap);
        if (snap.entry) toast.success(`Logged ${fmtHM(snap.entry.durationSeconds)}`, `on “${snap.entry.task?.title}”`);
        else if (!snap.alreadyStopped) toast('Timer stopped', { message: 'Less than a second was tracked, so nothing was saved.' });
        setVersion((v) => v + 1);
        return snap;
      }),
      discard: (taskId) => run(async () => { apply(await api.del(`/timer/${taskId}`)); setVersion((v) => v + 1); }),
    };
  }, [sessions, busy, version, run, apply, toast]);

  return <TimerCtx.Provider value={value}>{children}</TimerCtx.Provider>;
}

/** Re-renders the caller every second while `active` is true. */
export function useTick(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [active]);
  return now;
}
