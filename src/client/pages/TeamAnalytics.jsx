import { Fragment, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, Clock, Gauge, Users, Hourglass } from 'lucide-react';
import { api } from '../api';
import { useTimer } from '../context';
import { Avatar, ChartTip, Empty, ErrorState, Progress, Skeleton, Stat, useFetch } from '../ui';
import { APPROVAL, fmtDay, fmtHM, hoursOf, toInputDate } from '../format';
import { STAT_GRADIENTS as G } from '../theme';

const axis = { fill: 'var(--text-3)', fontSize: 11 };

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const PRESETS = [
  ['week', 'This week'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['custom', 'Custom'],
];
function rangeFor(preset, custom) {
  const t = new Date();
  if (preset === 'week') return { from: toInputDate(mondayOf(t)), to: toInputDate(t) };
  if (preset === '7') return { from: toInputDate(addDays(t, -6)), to: toInputDate(t) };
  if (preset === '30') return { from: toInputDate(addDays(t, -29)), to: toInputDate(t) };
  if (preset === 'month') return { from: toInputDate(new Date(t.getFullYear(), t.getMonth(), 1)), to: toInputDate(t) };
  return custom;
}

function Detail({ p }) {
  const chart = p.daily.map((x) => ({ label: fmtDay(x.date).split(',')[0] + ' ' + x.date.slice(8), hours: hoursOf(x.seconds) }));
  const max = Math.max(1, ...p.byProject.map((x) => x.seconds));
  return (
    <div className="grid g3" style={{ padding: '6px 4px 14px' }}>
      <div>
        <div className="small bold" style={{ marginBottom: 6 }}>Hours per day</div>
        <div style={{ height: 150 }}>
          <ResponsiveContainer>
            <AreaChart data={chart} margin={{ left: -24, right: 6, top: 6 }}>
              <defs><linearGradient id={`g${p.user.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={p.user.color} stopOpacity={0.5} /><stop offset="100%" stopColor={p.user.color} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" /><YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTip fmt={(v) => `${v} h`} />} />
              <Area type="monotone" dataKey="hours" name="Hours" stroke={p.user.color} strokeWidth={2} fill={`url(#g${p.user.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <div className="small bold" style={{ marginBottom: 8 }}>Time by project</div>
        {p.byProject.length === 0 ? <div className="faint small">No time tracked in this period.</div> : (
          <div className="stack" style={{ gap: 10 }}>{p.byProject.map((x) => (
            <div key={x.project.id}>
              <div className="row small" style={{ marginBottom: 4 }}><span className="dot" style={{ '--c': x.project.color }} /><span className="ellipsis grow">{x.project.name}</span><b className="tnum">{fmtHM(x.seconds)}</b><span className="faint xs" style={{ width: 38, textAlign: 'right' }}>{Math.round((x.seconds / p.seconds) * 100)}%</span></div>
              <div className="progress thin"><span style={{ width: `${(x.seconds / max) * 100}%`, background: x.project.color }} /></div>
            </div>
          ))}</div>
        )}
      </div>
      <div>
        <div className="small bold" style={{ marginBottom: 8 }}>Most time spent on</div>
        {p.topTasks.length === 0 ? <div className="faint small">—</div> : p.topTasks.map((t) => (
          <div key={t.id} className="task-row" style={{ cursor: 'default' }}>
            <span className="dot" style={{ '--c': t.project?.color || 'var(--text-3)' }} />
            <div className="grow"><div className="ellipsis small" style={{ fontWeight: 600 }}>{t.title}</div><div className="xs faint ellipsis">{t.project?.name}</div></div>
            <b className="tnum small">{fmtHM(t.seconds)}</b>
          </div>
        ))}
        <div className="row wrap xs" style={{ marginTop: 10, gap: 8 }}>
          {Object.entries(p.byApproval).filter(([, v]) => v > 0).map(([k, v]) => <span key={k} className="chip"><span className="dot" style={{ '--c': APPROVAL[k]?.color, width: 7, height: 7 }} /> {k} {fmtHM(v)}</span>)}
        </div>
      </div>
    </div>
  );
}

/** Admin: how much time every team member tracked, how it is split, their workload and what they are doing right now. */
export default function TeamAnalytics() {
  const { version } = useTimer();
  const [preset, setPreset] = useState('week');
  const [custom, setCustom] = useState({ from: toInputDate(addDays(new Date(), -13)), to: toInputDate(new Date()) });
  const [openId, setOpenId] = useState('');
  const { from, to } = useMemo(() => rangeFor(preset, custom), [preset, custom]);
  const { data, error, loading, reload } = useFetch(() => api.get(`/dashboard/people?from=${from}&to=${to}`), [from, to, version]);

  const chart = (data?.people || []).filter((p) => p.seconds > 0).map((p) => ({
    name: p.user.name.split(' ')[0],
    Approved: hoursOf(p.byApproval.approved), Submitted: hoursOf(p.byApproval.submitted), Draft: hoursOf(p.byApproval.draft), Rejected: hoursOf(p.byApproval.rejected),
  }));
  const t = data?.totals;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row wrap between">
        <div><h2 style={{ fontSize: 20 }}>Team analytics</h2><p className="small muted" style={{ marginTop: 3 }}>Time tracked by each team member{data ? ` · ${fmtDay(data.from)} → ${fmtDay(data.to)}` : ''}</p></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <div className="pills">{PRESETS.map(([k, l]) => <button key={k} className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>{l}</button>)}</div>
          {preset === 'custom' && (
            <div className="row" style={{ gap: 6 }}>
              <input type="date" className="input sm" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="From" />
              <span className="faint">→</span>
              <input type="date" className="input sm" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="To" />
            </div>
          )}
        </div>
      </div>

      {error && !data ? <ErrorState error={error} retry={reload} /> : !data ? <Skeleton h={260} /> : (
        <>
          <div className="grid g4">
            <Stat icon={Clock} label="Total tracked" value={fmtHM(t.seconds)} sub={`${data.workdays} working day${data.workdays === 1 ? '' : 's'} in this period`} color={G.indigo} />
            <Stat icon={Gauge} label="Utilisation" value={`${Math.round(t.utilization * 100)}%`} sub={`of ${data.hoursPerDay} h per working day, per person`} color={G.teal} />
            <Stat icon={Users} label="People who tracked time" value={`${t.tracking} / ${t.people}`} sub={`Average ${fmtHM(t.avgPerPerson)} each`} color={G.sky} />
            <Stat icon={Hourglass} label="Waiting for approval" value={fmtHM(t.pending)} sub={t.pending ? 'Submitted, not reviewed yet' : 'All clear'} color={G.amber} />
          </div>

          {data.people.length === 0 ? <div className="card"><Empty icon={Users} title="No team members yet">Approved employees appear here.</Empty></div> : (
            <>
              <div className="card">
                <div className="card-title"><h3>Hours per person</h3><small>split by approval status</small></div>
                {chart.length === 0 ? <div className="faint small">No time tracked in this period.</div> : (
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={chart} margin={{ left: -16, right: 8 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTip fmt={(v) => `${v} h`} />} cursor={{ fill: 'var(--surface-2)' }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Approved" stackId="a" fill={APPROVAL.approved.color} />
                        <Bar dataKey="Submitted" stackId="a" fill={APPROVAL.submitted.color} />
                        <Bar dataKey="Draft" stackId="a" fill={APPROVAL.draft.color} />
                        <Bar dataKey="Rejected" stackId="a" fill={APPROVAL.rejected.color} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="card" style={{ padding: 8 }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Team member</th><th>Tracked</th><th style={{ minWidth: 140 }}>Utilisation</th><th>Active days</th><th>Avg / day</th><th>Open</th><th>Overdue</th><th>Done</th><th>Planned</th><th /></tr></thead>
                    <tbody>
                      {data.people.map((p) => {
                        const on = openId === p.user.id;
                        return (
                          <Fragment key={p.user.id}>
                            <tr className="click" onClick={() => setOpenId(on ? '' : p.user.id)}>
                              <td>
                                <div className="row"><Avatar user={p.user} size={32} />
                                  <div><b>{p.user.name}</b><div className="xs faint">{p.user.title || (p.user.role === 'manager' ? 'Project Manager' : p.user.role === 'owner' ? 'Admin' : 'Employee')}</div></div>
                                  {p.now && <span className="chip danger" title={`${p.now.task} · ${p.now.project}`}><span className="dot pulse" style={{ width: 6, height: 6 }} /> tracking now</span>}
                                </div>
                              </td>
                              <td><b className="tnum">{fmtHM(p.seconds)}</b></td>
                              <td><div className="row xs muted" style={{ marginBottom: 4 }}>{Math.round(p.utilization * 100)}%</div><Progress value={Math.min(100, p.utilization * 100)} thin /></td>
                              <td className="tnum">{p.activeDays}</td>
                              <td className="tnum">{p.activeDays ? fmtHM(p.avgPerActiveDay) : '—'}</td>
                              <td className="tnum">{p.tasks.open}</td>
                              <td>{p.tasks.overdue ? <span className="chip danger">{p.tasks.overdue}</span> : <span className="faint">—</span>}</td>
                              <td className="tnum">{p.tasks.completed}</td>
                              <td className="tnum">{p.tasks.plannedSeconds ? fmtHM(p.tasks.plannedSeconds) : '—'}</td>
                              <td>{on ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                            </tr>
                            {on && <tr><td colSpan={10} style={{ background: 'var(--surface-2)' }}><Detail p={p} /></td></tr>}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="xs faint">Utilisation = tracked time ÷ ({data.hoursPerDay} h × working days). Planned = estimates on open tasks assigned to the person. Tracked time reflects recorded work, not productivity or quality.</p>
            </>
          )}
        </>
      )}
      {loading && data && <div className="xs faint">Updating…</div>}
    </div>
  );
}
