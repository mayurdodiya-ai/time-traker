import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clock, CalendarClock, AlertTriangle, ListChecks, FolderKanban, CheckSquare, TrendingUp, Flame, ArrowRight, Sparkles, Hourglass } from 'lucide-react';
import { api } from '../api';
import { useAuth, useTimer } from '../context';
import { Avatar, ChartTip, Empty, ErrorState, PageSkeleton, PriorityBadge, Ring, Stat, useFetch } from '../ui';
import { TimerButton, useOpenTask } from '../components';
import { prefetchTask } from '../taskCache';
import TeamAnalytics from './TeamAnalytics';
import { APPROVAL, STATUS, fmtDate, fmtDay, fmtHM, hoursOf, isOverdue, ticketLabel } from '../format';
import { STAT_GRADIENTS as G, CHART_PALETTE } from '../theme';

const axis = { fill: 'var(--text-3)', fontSize: 11 };
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

function TaskLine({ t, open }) {
  const over = isOverdue(t);
  return (
    <div className="task-row" onMouseEnter={() => prefetchTask(t.id)} onClick={() => open(t.id)}>
      <span className="dot" style={{ '--c': t.project.color }} />
      <div className="grow">
        <div className="ellipsis" style={{ fontWeight: 600 }}>{t.parent && <span className="faint">↳ </span>}{t.ticketNumber && <span className="ticket">{ticketLabel(t)}</span>}{t.title}</div>
        <div className="xs faint ellipsis">{t.project.name} · {STATUS[t.status].label}{t.totals.estimate != null && ` · ${fmtHM(t.totals.total)} / ${fmtHM(t.totals.estimate)}`}</div>
      </div>
      {t.deadline && <span className={`chip ${over ? 'danger' : ''}`}><CalendarClock size={11} /> {fmtDate(t.deadline)}</span>}
      <PriorityBadge priority={t.priority} />
      <TimerButton task={t} />
    </div>
  );
}

function MyWork({ d }) {
  const open = useOpenTask();
  const { running } = useTimer();
  const m = d.me;
  const ts = m.timesheet;
  const tsTotal = Object.values(ts).reduce((a, b) => a + b, 0);
  const chart = m.daily.map((x) => ({ ...x, label: fmtDay(x.date).split(',')[0] + ' ' + x.date.slice(8), hours: hoursOf(x.seconds) }));
  const focus = [...m.tasks].sort((a, b) => (isOverdue(b) - isOverdue(a)) || ((new Date(a.deadline || 9e15)) - (new Date(b.deadline || 9e15)))).slice(0, 7);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid g4">
        <Stat icon={Clock} label="Tracked today" value={fmtHM(m.todaySeconds)} sub={running ? 'Timer running now' : 'Start a timer to begin'} color={G.indigo} />
        <Stat icon={TrendingUp} label="This week" value={fmtHM(m.weekSeconds)} sub="Monday to now" color={G.teal} />
        <Stat icon={ListChecks} label="Open work items" value={m.tasks.length} sub={`${m.upcoming.length} due in the next 7 days`} color={G.sky} />
        <Stat icon={AlertTriangle} label="Overdue" value={m.overdue.length} sub={m.overdue.length ? 'Needs attention' : 'Nothing overdue 🎉'} color={m.overdue.length ? G.rose : G.amber} />
      </div>

      <div className="grid g-main">
        <div className="stack" style={{ gap: 20 }}>
          <div className="card">
            <div className="card-title"><h3>Last 14 days</h3><small>hours tracked per day</small></div>
            <div style={{ height: 230 }}>
              <ResponsiveContainer>
                <AreaChart data={chart} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART_PALETTE[1]} stopOpacity={0.55} /><stop offset="100%" stopColor={CHART_PALETTE[1]} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={1} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} unit="h" />
                  <Tooltip content={<ChartTip fmt={(v) => `${v} h`} />} cursor={{ stroke: 'var(--border-strong)' }} />
                  <Area type="monotone" dataKey="hours" name="Tracked" stroke={CHART_PALETTE[1]} strokeWidth={2.5} fill="url(#ga)" dot={false} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-title"><h3>My focus</h3><Link to="/projects" className="btn ghost sm">All projects <ArrowRight size={14} /></Link></div>
            {focus.length === 0 ? <Empty icon={Sparkles} title="Nothing assigned right now">When a manager assigns you work it will show up here.</Empty> : focus.map((t) => <TaskLine key={t.id} t={t} open={open} />)}
          </div>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <div className="card">
            <div className="card-title"><h3>Timesheet · this week</h3></div>
            {tsTotal === 0 ? <div className="faint small">No time recorded this week yet.</div> : (
              <>
                <div className="segbar">{Object.entries(ts).map(([k, v]) => v > 0 && <span key={k} style={{ width: `${(v / tsTotal) * 100}%`, background: APPROVAL[k].color }} title={`${APPROVAL[k].label}: ${fmtHM(v)}`} />)}</div>
                <div className="legend" style={{ marginTop: 14 }}>
                  {Object.entries(ts).map(([k, v]) => <div key={k} className="li"><span className="swatch" style={{ '--c': APPROVAL[k].color }} />{APPROVAL[k].label}<span>{fmtHM(v)}</span></div>)}
                </div>
                {ts.draft + ts.rejected > 0 && <Link to="/time" className="btn sm" style={{ marginTop: 14, width: '100%' }}>Review &amp; submit timesheet</Link>}
              </>
            )}
          </div>

          <div className="card">
            <div className="card-title"><h3>Upcoming deadlines</h3></div>
            {[...m.overdue, ...m.upcoming].length === 0 ? <div className="faint small">No deadlines in the next 7 days.</div> :
              [...m.overdue, ...m.upcoming].slice(0, 5).map((t) => (
                <div key={t.id} className="task-row" onClick={() => open(t.id)}>
                  <div className="grow"><div className="ellipsis small" style={{ fontWeight: 600 }}>{t.title}</div><div className="xs faint">{t.project.name}</div></div>
                  <span className={`chip ${isOverdue(t) ? 'danger' : 'warn'}`}>{fmtDate(t.deadline)}</span>
                </div>
              ))}
          </div>

          <div className="card">
            <div className="card-title"><h3>Recently tracked</h3><Link to="/time" className="btn ghost sm">History</Link></div>
            {m.recent.length === 0 ? <div className="faint small">Nothing tracked yet.</div> : m.recent.map((e) => (
              <div key={e.id} className="task-row" style={{ cursor: 'default' }}>
                <span className="dot" style={{ '--c': e.project.color }} />
                <div className="grow"><div className="ellipsis small" style={{ fontWeight: 600 }}>{e.task.title}</div><div className="xs faint">{fmtDay(e.workDate)}</div></div>
                <b className="tnum small">{fmtHM(e.durationSeconds)}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamView({ d }) {
  const { can } = useAuth();
  const t = d.team;
  const statusTotal = Object.values(t.tasksByStatus).reduce((a, b) => a + b, 0);
  const maxPerson = Math.max(1, ...t.topPeople.map((p) => p.seconds));
  const ev = t.projects.filter((p) => p.estimate > 0).map((p) => ({ name: p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name, Estimate: hoursOf(p.estimate), Actual: hoursOf(p.actual) }));
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid g4">
        <Stat icon={FolderKanban} label="Active projects" value={t.totals.active} sub={`${t.totals.projects} total · ${t.totals.completed} completed`} color={G.indigo} />
        <Stat icon={Hourglass} label="Total tracked" value={fmtHM(t.totals.actual)} sub={t.totals.estimate ? `of ${fmtHM(t.totals.estimate)} estimated` : 'No estimates yet'} color={G.teal} />
        <Stat icon={Flame} label="Overdue tasks" value={t.overdue} sub={`${t.totals.delayed} project${t.totals.delayed === 1 ? '' : 's'} past target date`} color={t.overdue ? G.rose : G.amber} />
        {t.canReview
          ? <Stat icon={CheckSquare} label="Pending approvals" value={t.pendingApprovals} sub={t.pendingApprovals ? 'Waiting for review' : 'All clear'} color={G.sky} />
          : <Stat icon={CheckSquare} label="Tasks in flight" value={(t.tasksByStatus.in_progress || 0) + (t.tasksByStatus.in_review || 0)} sub="In progress or in review" color={G.sky} />}
      </div>

      <div className="grid g3">
        <div className="card">
          <div className="card-title"><h3>Estimate vs actual</h3><small>hours</small></div>
          {ev.length === 0 ? <div className="faint small">Add estimates to tasks to compare.</div> : (
            <div style={{ height: 210 }}><ResponsiveContainer><BarChart data={ev} margin={{ left: -20 }} barGap={4}>
              <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTip fmt={(v) => `${v} h`} />} cursor={{ fill: 'var(--surface-2)' }} />
              <Bar dataKey="Estimate" fill="#8d91a8" radius={[6, 6, 0, 0]} /><Bar dataKey="Actual" fill={CHART_PALETTE[1]} radius={[6, 6, 0, 0]} />
            </BarChart></ResponsiveContainer></div>
          )}
        </div>
        <div className="card">
          <div className="card-title"><h3>Team time</h3><small>this week</small></div>
          {t.topPeople.length === 0 ? <div className="faint small">No time tracked this week.</div> : (
            <div className="stack">{t.topPeople.map((p) => (
              <div key={p.user.id}><div className="row small" style={{ marginBottom: 5 }}><Avatar user={p.user} size={22} /><b>{p.user.name}</b><span className="right tnum muted">{fmtHM(p.seconds)}</span></div>
                <div className="progress thin"><span style={{ width: `${(p.seconds / maxPerson) * 100}%`, background: p.user.color }} /></div></div>
            ))}</div>
          )}
        </div>
        <div className="card">
          <div className="card-title"><h3>Tasks by status</h3><small>{statusTotal} items</small></div>
          <div className="segbar">{Object.entries(STATUS).map(([k, v]) => t.tasksByStatus[k] > 0 && <span key={k} style={{ width: `${(t.tasksByStatus[k] / statusTotal) * 100}%`, background: v.color }} />)}</div>
          <div className="legend" style={{ marginTop: 16 }}>{Object.entries(STATUS).map(([k, v]) => <div key={k} className="li"><span className="swatch" style={{ '--c': v.color }} />{v.label}<span>{t.tasksByStatus[k] || 0}</span></div>)}</div>
        </div>
      </div>
      {can.owner && <TeamAnalytics />}
      <p className="xs faint">Tracked time reflects recorded work and is not a measure of employee productivity or quality.</p>
    </div>
  );
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const { version } = useTimer();
  const { data, error, reload } = useFetch(() => api.get('/dashboard'), [version]);
  const [tab, setTab] = useState(null);
  if (error && !data) return <div className="page"><ErrorState error={error} retry={reload} /></div>;
  if (!data) return <div className="page"><PageSkeleton /></div>;
  const view = tab || (data.team ? 'team' : 'mine');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greet()}, {user.name.split(' ')[0]} 👋</h1>
          <p>{new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} · here’s where things stand.</p>
        </div>
        {data.team && can.track && <div className="tabs"><button className={view === 'team' ? 'on' : ''} onClick={() => setTab('team')}>Team overview</button><button className={view === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My work</button></div>}
      </div>
      {view === 'team' && data.team ? <TeamView d={data} /> : <MyWork d={data} />}
    </div>
  );
}
