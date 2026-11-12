import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Clock, Zap, ShieldCheck, ListChecks, Info } from 'lucide-react';
import { api, qs } from '../api';
import { useAuth, useTimer, useToast } from '../context';
import { Avatar, ChartTip, Empty, ErrorState, PageSkeleton, Progress, Select, Stat, useFetch } from '../ui';
import { APPROVAL, addDaysStr, dateStr, fmtDay, fmtHM, hoursOf } from '../format';
import { STAT_GRADIENTS as G, CHART_PALETTE } from '../theme';

const axis = { fill: 'var(--text-3)', fontSize: 11 };
const PRESETS = [['7d', 'Last 7 days', () => [addDaysStr(dateStr(), -6), dateStr()]], ['30d', 'Last 30 days', () => [addDaysStr(dateStr(), -29), dateStr()]],
  ['month', 'This month', () => [dateStr().slice(0, 8) + '01', dateStr()]], ['90d', 'Last 90 days', () => [addDaysStr(dateStr(), -89), dateStr()]]];

export default function Reports() {
  const { can } = useAuth();
  const toast = useToast();
  const { version } = useTimer();
  const [preset, setPreset] = useState('30d');
  const [range, setRange] = useState(PRESETS[1][2]());
  const [project, setProject] = useState('');
  const [user, setUser] = useState('');
  const [source, setSource] = useState('');
  const params = { from: range[0], to: range[1], project, user, source };
  const projects = useFetch(() => api.get('/projects'), []);
  const people = useFetch(() => (can.manage ? api.get('/users') : Promise.resolve([])), [can.manage]);
  const { data, error, loading, reload } = useFetch(() => api.get(`/reports/summary${qs(params)}`), [range[0], range[1], project, user, source, version]);

  const pick = (k) => { setPreset(k); setRange(PRESETS.find((p) => p[0] === k)[2]()); };
  const exportCsv = async () => { try { await api.download(`/reports/export${qs(params)}`, `time-report_${range[0]}_${range[1]}.csv`); toast.success('Report exported'); } catch (e) { toast.error('Export failed', e.message); } };

  if (error && !data) return <div className="page"><ErrorState error={error} retry={reload} /></div>;
  const d = data;
  const timerShare = d && d.totalSeconds ? Math.round(((d.bySource.timer || 0) / d.totalSeconds) * 100) : 0;
  const approvedShare = d && d.totalSeconds ? Math.round(((d.byStatus.approved?.seconds || 0) / d.totalSeconds) * 100) : 0;
  const daily = d?.days.map((x) => ({ label: x.date.slice(5), hours: hoursOf(x.seconds), full: fmtDay(x.date) })) || [];
  const pie = d?.byProject.map((x) => ({ name: x.project.name, value: hoursOf(x.seconds), fill: x.project.color })) || [];
  const maxU = Math.max(1, ...(d?.byUser.map((x) => x.seconds) || [1]));
  const statusTotal = d ? Object.values(d.byStatus).reduce((s, x) => s + x.seconds, 0) : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Reports</h1><p>{can.owner ? 'Company-wide time reports.' : can.manage ? 'Time on your projects and team.' : 'Your own time records.'} {d && `${d.from} → ${d.to}`}</p></div>
        <button className="btn primary" onClick={exportCsv} disabled={!d}><Download size={16} /> Export CSV</button>
      </div>

      <div className="card" style={{ marginBottom: 20, padding: 14 }}>
        <div className="row wrap between">
          <div className="pills">{PRESETS.map(([k, l]) => <button key={k} className={preset === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}</div>
          <div className="row wrap">
            <input type="date" className="input sm" style={{ width: 140 }} value={range[0]} max={range[1]} onChange={(e) => { setPreset(''); setRange([e.target.value, range[1]]); }} aria-label="From" />
            <span className="faint">→</span>
            <input type="date" className="input sm" style={{ width: 140 }} value={range[1]} min={range[0]} max={dateStr()} onChange={(e) => { setPreset(''); setRange([range[0], e.target.value]); }} aria-label="To" />
            <Select className="sm" style={{ width: 160 }} value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            {can.manage && <Select className="sm" style={{ width: 150 }} value={user} onChange={(e) => setUser(e.target.value)}><option value="">Everyone</option>{people.data?.filter((u) => u.role !== 'viewer').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
            <Select className="sm" style={{ width: 130 }} value={source} onChange={(e) => setSource(e.target.value)}><option value="">Timer + manual</option><option value="timer">Timer only</option><option value="manual">Manual only</option></Select>
          </div>
        </div>
      </div>

      {!d ? <PageSkeleton /> : d.entryCount === 0 ? <div className="card"><Empty icon={Clock} title="No time recorded in this period">Try widening the date range or clearing a filter.</Empty></div> : (
        <div className="stack" style={{ gap: 20, opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
          <div className="grid g4">
            <Stat icon={Clock} label="Total recorded" value={fmtHM(d.totalSeconds)} sub={`${hoursOf(d.totalSeconds)} hours`} color={G.indigo} />
            <Stat icon={ListChecks} label="Time entries" value={d.entryCount} sub={`avg ${fmtHM(d.totalSeconds / d.entryCount)} per entry`} color={G.sky} />
            <Stat icon={Zap} label="Timer-recorded" value={`${timerShare}%`} sub={`${fmtHM(d.bySource.manual || 0)} added manually`} color={G.amber} />
            <Stat icon={ShieldCheck} label="Approved" value={`${approvedShare}%`} sub={`${fmtHM(d.byStatus.approved?.seconds || 0)} locked`} color={G.teal} />
          </div>

          <div className="grid g-main">
            <div className="card">
              <div className="card-title"><h3>Hours per day</h3></div>
              <div style={{ height: 250 }}><ResponsiveContainer><BarChart data={daily} margin={{ left: -18 }}>
                <defs><linearGradient id="rb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART_PALETTE[1]} /><stop offset="100%" stopColor={CHART_PALETTE[0]} /></linearGradient></defs>
                <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={daily.length > 20 ? Math.floor(daily.length / 10) : 0} /><YAxis tick={axis} tickLine={false} axisLine={false} unit="h" />
                <Tooltip content={<ChartTip fmt={(v) => `${v} h`} />} cursor={{ fill: 'var(--surface-2)' }} labelFormatter={(_, p) => p?.[0]?.payload.full} />
                <Bar dataKey="hours" name="Hours" fill="url(#rb)" radius={[6, 6, 0, 0]} />
              </BarChart></ResponsiveContainer></div>
            </div>
            <div className="card">
              <div className="card-title"><h3>By project</h3></div>
              <div className="row" style={{ gap: 16 }}>
                <div style={{ width: 150, height: 150, flex: 'none' }}><ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" innerRadius={46} outerRadius={70} paddingAngle={3} stroke="none">{pie.map((p, i) => <Cell key={i} fill={p.fill} />)}</Pie><Tooltip content={<ChartTip fmt={(v) => `${v} h`} />} /></PieChart></ResponsiveContainer></div>
                <div className="legend grow">{pie.map((p) => <div key={p.name} className="li"><span className="swatch" style={{ '--c': p.fill }} /><span className="ellipsis">{p.name}</span><span>{p.value} h</span></div>)}</div>
              </div>
            </div>
          </div>

          <div className="grid g3">
            {d.byUser.length > 0 && (
              <div className="card"><div className="card-title"><h3>By employee</h3></div>
                <div className="stack">{d.byUser.map((x) => (
                  <div key={x.user.id}><div className="row small" style={{ marginBottom: 5 }}><Avatar user={x.user} size={22} /><b>{x.user.name}</b><span className="right tnum muted">{fmtHM(x.seconds)}</span></div>
                    <div className="progress thin"><span style={{ width: `${(x.seconds / maxU) * 100}%`, background: x.user.color }} /></div></div>
                ))}</div></div>
            )}
            <div className="card"><div className="card-title"><h3>Most time-consuming work</h3></div>
              <div className="stack" style={{ gap: 10 }}>{d.byTask.map((x, i) => (
                <div key={x.task.id} className="row"><span className="faint bold" style={{ width: 18 }}>{i + 1}</span><span className="dot" style={{ '--c': x.task.project.color }} />
                  <div className="grow"><div className="ellipsis small" style={{ fontWeight: 600 }}>{x.task.title}</div><div className="xs faint">{x.task.project.name}</div></div><b className="tnum small">{fmtHM(x.seconds)}</b></div>
              ))}</div></div>
            <div className="card"><div className="card-title"><h3>Approval status</h3></div>
              <div className="segbar">{Object.entries(APPROVAL).map(([k, v]) => d.byStatus[k] && <span key={k} style={{ width: `${(d.byStatus[k].seconds / statusTotal) * 100}%`, background: v.color }} />)}</div>
              <div className="legend" style={{ marginTop: 16 }}>{Object.entries(APPROVAL).map(([k, v]) => <div key={k} className="li"><span className="swatch" style={{ '--c': v.color }} />{v.label}<span>{fmtHM(d.byStatus[k]?.seconds || 0)} · {d.byStatus[k]?.count || 0}</span></div>)}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-title"><h3>Estimated vs actual effort</h3><small>per project, all time</small></div>
            <div className="table-wrap"><table className="table"><thead><tr><th>Project</th><th>Estimate</th><th>Actual</th><th>Variance</th><th style={{ width: '28%' }}>Consumption</th></tr></thead>
              <tbody>{d.estimateVsActual.map((p) => {
                const diff = p.actual - p.estimate; const r = p.estimate ? (p.actual / p.estimate) * 100 : null;
                return <tr key={p.id}><td><div className="row"><span className="dot" style={{ '--c': p.color }} /><b>{p.name}</b></div></td>
                  <td className="tnum">{p.estimate ? fmtHM(p.estimate) : <span className="faint">no estimate</span>}</td><td className="tnum">{fmtHM(p.actual)}</td>
                  <td className="tnum" style={{ color: !p.estimate ? undefined : diff > 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{p.estimate ? `${diff > 0 ? '+' : '−'}${fmtHM(Math.abs(diff))}` : '—'}</td>
                  <td>{r != null ? <div className="row"><div className="grow"><Progress value={r} over={r > 100} thin /></div><span className="xs muted" style={{ width: 38 }}>{Math.round(r)}%</span></div> : <span className="faint">—</span>}</td></tr>;
              })}</tbody></table></div>
          </div>
          <div className="callout info"><Info size={17} style={{ flex: 'none' }} /><span>Reports are built from recorded time entries. Parent task totals include their subtasks, but each entry is counted exactly once. Tracked hours are one input for planning — not a measure of productivity or quality.</span></div>
        </div>
      )}
    </div>
  );
}
