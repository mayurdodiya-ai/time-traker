import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, Clock, BarChart3, Users, Settings, Bell, Sun, Moon, Menu,
  Timer, Pause, Square, Play, LogOut, WifiOff, CheckCheck,
} from 'lucide-react';
import { api } from './api';
import { useAuth, useTheme, useTimer, useTick } from './context';
import { Avatar, useFetch } from './ui';
import { ROLE_LABEL, fmtClock, fmtHM, ago } from './format';
import TaskDrawer from './TaskDrawer';

function Brand({ onToggle }) {
  return (
    <div className="brand">
      <div className="brand-mark"><Timer size={21} strokeWidth={2.6} /></div>
      <div><b>Time Tracker</b></div>
      {onToggle && <button className="btn icon ghost sm sidebar-toggle" onClick={onToggle} aria-label="Collapse sidebar"><Menu size={17} /></button>}
    </div>
  );
}

function NavItem({ to, icon: Icon, label, count, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
      <Icon size={19} /> {label}{count > 0 && <span className="count">{count}</span>}
    </NavLink>
  );
}

function MiniNavItem({ to, icon: Icon, label, end, onOpen }) {
  return (
    <NavLink to={to} end={end} title={label} aria-label={label} onClick={onOpen} className={({ isActive }) => (isActive ? 'active' : '')}>
      <Icon size={19} />
    </NavLink>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef();
  const { data, reload } = useFetch(() => api.get('/notifications'), []);
  useEffect(() => { const i = setInterval(reload, 45000); return () => clearInterval(i); }, [reload]);
  useEffect(() => {
    const h = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const read = async (id) => { await api.post('/notifications/read', id ? { id } : {}); reload(); };
  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button className="btn icon" onClick={() => { setOpen(!open); if (!open) reload(); }} aria-label="Notifications" style={{ position: 'relative' }}>
        <Bell size={18} />
        {data?.unread > 0 && <span className="count" style={{ position: 'absolute', top: -5, right: -5, background: 'var(--danger)', color: 'var(--on-danger)', fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 6px' }}>{data.unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="pop-head"><b>Notifications</b>{data?.unread > 0 && <button className="btn ghost sm" onClick={() => read()}><CheckCheck size={14} /> Mark all read</button>}</div>
          <div className="pop-list">
            {!data?.items.length && <div className="empty" style={{ padding: 30 }}>You’re all caught up 🎉</div>}
            {data?.items.map((n) => (
              <button key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => { read(n.id); setOpen(false); if (n.link) nav(n.link); }}>
                {!n.read && <span className="dot" />}
                <div style={{ marginLeft: n.read ? 20 : 0 }}><div className="small">{n.text}</div><div className="faint xs">{ago(n.createdAt)}</div></div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimerDock() {
  const { running, paused, elapsedOf, pause, stop, start, busy, sessions } = useTimer();
  const nav = useNavigate();
  const now = useTick(!!running);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!sessions.length) return null;
  const open = (s) => nav(`/projects/${s.project.id}?task=${s.task.id}`);
  return (
    <div className={`dock ${running ? 'live' : ''}`}>
      {paused.length > 0 && (
        <div className="dock-paused">
          {paused.slice(0, 4).map((s) => (
            <button key={s.id} onClick={() => start(s.task.id)} disabled={busy || !online} title="Resume this timer">
              <Pause size={12} /> <span className="ellipsis" style={{ maxWidth: 180 }}>{s.task.title}</span>
              <b className="tnum">{fmtHM(elapsedOf(s, now))}</b> <Play size={12} color="var(--success)" />
            </button>
          ))}
        </div>
      )}
      {running ? (
        <div className="dock-inner" style={{ marginTop: paused.length ? 8 : 0 }}>
          <span className="dot pulse" />
          <div className="clock">{fmtClock(elapsedOf(running, now))}</div>
          <div className="info" onClick={() => open(running)} style={{ cursor: 'pointer' }}>
            <b className="ellipsis">{running.task.parent && <span className="faint">{running.task.parent.title} › </span>}{running.task.title}</b>
            <small className="ellipsis" style={{ display: 'block' }}>{running.project.name}{!online && ' · offline — reconnect to sync'}</small>
          </div>
          <button className="btn" onClick={pause} disabled={busy || !online}><Pause size={16} /> Pause</button>
          <button className="btn danger" onClick={() => stop(running.task.id)} disabled={busy || !online}><Square size={15} /> Stop</button>
        </div>
      ) : (
        <div className="dock-inner" style={{ marginTop: paused.length ? 8 : 0 }}>
          <Pause size={18} color="var(--warn)" />
          <div className="info"><b>No timer running</b><small>{paused.length} paused — resume one above or stop it to save the time.</small></div>
          {paused[0] && <button className="btn danger sm" onClick={() => stop(paused[0].task.id)} disabled={busy}><Square size={14} /> Stop &amp; save “{paused[0].task.title.slice(0, 18)}”</button>}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, can, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { version } = useTimer();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [params, setParams] = useSearchParams();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const taskId = params.get('task');
  const closeTask = () => { const p = new URLSearchParams(params); p.delete('task'); setParams(p, { replace: true }); };

  return (
    <div className={`shell ${sidebarOpen ? '' : 'mini'}`}>
      {sidebarOpen ? (
      <aside className="sidebar">
        <Brand onToggle={() => setSidebarOpen(false)} />
        <nav className="nav">
          <div className="nav-label">Workspace</div>
          <NavItem to="/" end icon={LayoutDashboard} label="Dashboard" />
          <NavItem to="/projects" icon={FolderKanban} label="Projects" />
          {can.track && <NavItem to="/time" icon={Clock} label="My Time" />}
          <NavItem to="/reports" icon={BarChart3} label="Reports" />
          {can.owner && (<><div className="nav-label">Administration</div>
            <NavItem to="/people" icon={Users} label="People" /></>)}
          <div className="nav-label">Account</div>
          <NavItem to="/settings" icon={Settings} label="Settings" />
        </nav>
        <div className="sidebar-foot">
          <div className="usercard">
            <Avatar user={user} size={36} />
            <div><b>{user.name}</b><small>{ROLE_LABEL[user.role]}</small></div>
            <button className="btn ghost icon sm" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
      ) : (
      <aside className="sidebar mini">
        <button className="brand-mark" onClick={() => setSidebarOpen(true)} title="Open sidebar" aria-label="Open sidebar"><Timer size={20} strokeWidth={2.6} /></button>
        <nav className="nav">
          <MiniNavItem to="/" end icon={LayoutDashboard} label="Dashboard" onOpen={() => setSidebarOpen(true)} />
          <MiniNavItem to="/projects" icon={FolderKanban} label="Projects" onOpen={() => setSidebarOpen(true)} />
          {can.track && <MiniNavItem to="/time" icon={Clock} label="My Time" onOpen={() => setSidebarOpen(true)} />}
          <MiniNavItem to="/reports" icon={BarChart3} label="Reports" onOpen={() => setSidebarOpen(true)} />
          {can.owner && <MiniNavItem to="/people" icon={Users} label="People" onOpen={() => setSidebarOpen(true)} />}
          <MiniNavItem to="/settings" icon={Settings} label="Settings" onOpen={() => setSidebarOpen(true)} />
        </nav>
        <div className="sidebar-foot">
          <button className="btn icon ghost" onClick={() => setSidebarOpen(true)} title={user.name} aria-label={user.name}><Avatar user={user} size={30} /></button>
        </div>
      </aside>
      )}

      <div className="main">
        {!online && <div className="offline-bar"><WifiOff size={13} style={{ verticalAlign: -2 }} /> You’re offline — changes can’t sync until you reconnect. Timers keep counting on the server.</div>}
        <div className="top-actions">
          <button className="btn icon" onClick={toggle} aria-label="Toggle theme" title="Toggle light / dark">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Notifications />
        </div>
        <Outlet />
      </div>

      {can.track && <TimerDock />}
      {taskId && <TaskDrawer key={taskId} id={taskId} onClose={closeTask} />}
    </div>
  );
}
