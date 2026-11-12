import { Router } from '../router.js';
import { Task, Project, TimeEntry, TimerSession, User, Notification, AuditEvent } from '../models/index.js';
import {
  authenticate, requireRole, isOwner, todayStr, addDays, visibleProjectFilter, computeTotals, secondsByTask, projectTotals, bad,
} from '../util.js';

export const dashboard = Router();
export const reports = Router();
export const notifications = Router();
export const auditLog = Router();
for (const r of [dashboard, reports, notifications, auditLog]) r.use(authenticate);

const sumBy = (rows, key) => Object.fromEntries(rows.map((r) => [String(r._id), r.s]));
const weekStartOf = (today) => {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -((dow + 6) % 7)); // Monday
};

const TASK_POP = [
  { path: 'assignee', select: 'name color' },
  { path: 'project', select: 'name color status' },
];

// The manager / owner part of the dashboard (kept separate so it can run at the same time as the personal part).
async function buildTeam(me, weekStart, now) {
  const pFilter = isOwner(me) ? {} : { manager: me._id };
  const projects = await Project.find(pFilter).populate('manager', 'name color').lean();
  const ids = projects.map((p) => p._id);
  const canReview = isOwner(me); // only the admin approves time
  const [per, weekEntries, pendingApprovals] = await Promise.all([
    projectTotals(ids),
    TimeEntry.aggregate([
      { $match: { project: { $in: ids }, workDate: { $gte: weekStart } } },
      { $facet: {
        byProject: [{ $group: { _id: '$project', s: { $sum: '$durationSeconds' } } }],
        byUser: [{ $group: { _id: '$user', s: { $sum: '$durationSeconds' } } }, { $sort: { s: -1 } }, { $limit: 8 }],
      } },
    ]),
    canReview ? TimeEntry.countDocuments({ approvalStatus: 'submitted', user: { $ne: me._id } }) : 0,
  ]);
  const users = await User.find({ _id: { $in: weekEntries[0].byUser.map((u) => u._id) } }).select('name color title');
  const tasksByStatus = {};
  let overdue = 0;
  const projectRows = projects.map((p) => {
    const s = per.get(String(p._id));
    overdue += s.overdue;
    for (const [k, v] of Object.entries(s.byStatus)) tasksByStatus[k] = (tasksByStatus[k] || 0) + v;
    return { id: String(p._id), name: p.name, color: p.color, status: p.status, manager: p.manager, targetDate: p.targetDate, ...s };
  });
  const weekByProject = sumBy(weekEntries[0].byProject, '_id');
  return {
    projects: projectRows,
    tasksByStatus,
    overdue,
    pendingApprovals,
    canReview,
    weekByProject: projectRows.map((p) => ({ id: p.id, name: p.name, color: p.color, seconds: weekByProject[p.id] || 0 })).filter((p) => p.seconds),
    topPeople: weekEntries[0].byUser.map((u) => ({ user: users.find((x) => String(x._id) === String(u._id)), seconds: u.s })).filter((x) => x.user),
    totals: {
      projects: projects.length,
      active: projects.filter((p) => p.status === 'active').length,
      completed: projects.filter((p) => p.status === 'completed').length,
      delayed: projects.filter((p) => p.targetDate && new Date(p.targetDate) < now && !['completed', 'archived'].includes(p.status)).length,
      actual: projectRows.reduce((s, p) => s + p.actual, 0),
      estimate: projectRows.reduce((s, p) => s + p.estimate, 0),
    },
  };
}

dashboard.get('/', async (req, res) => {
  const me = req.user;
  const today = todayStr();
  const weekStart = weekStartOf(today);
  const from14 = addDays(today, -13);
  const now = new Date();
  const teamP = ['owner', 'manager'].includes(me.role) ? buildTeam(me, weekStart, now) : null; // starts right away, in parallel with the rest

  const openFilter = { status: { $nin: ['completed', 'cancelled'] } };
  const [mine, recent, myDocs] = await Promise.all([
    TimeEntry.find({ user: me._id, workDate: { $gte: from14 } }).lean(),
    TimeEntry.find({ user: me._id }).sort({ createdAt: -1 }).limit(6).populate('project', 'name color').populate('task', 'title'),
    Task.find({ ...openFilter, $or: [{ assignee: me._id }, { collaborators: me._id }] }).populate(TASK_POP).sort({ deadline: 1 }).limit(60),
  ]);
  const daily = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(from14, i);
    daily.push({ date: d, seconds: mine.filter((e) => e.workDate === d).reduce((s, e) => s + e.durationSeconds, 0) });
  }
  const todaySeconds = daily.at(-1).seconds;
  const weekSeconds = mine.filter((e) => e.workDate >= weekStart).reduce((s, e) => s + e.durationSeconds, 0);
  const timesheet = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
  mine.filter((e) => e.workDate >= weekStart).forEach((e) => (timesheet[e.approvalStatus] += e.durationSeconds));

  const projIds = [...new Set(myDocs.map((t) => String(t.project._id)))];
  const [all, secs] = await Promise.all([
    Task.find({ project: { $in: projIds } }).select('parent estimateSeconds status').lean(),
    secondsByTask({ project: { $in: projIds } }),
  ]);
  const totals = computeTotals(all, secs);
  const myTasks = myDocs.map((d) => ({ ...d.toJSON(), totals: totals.get(String(d._id)) }));
  const soon = new Date(now.getTime() + 7 * 864e5);

  const out = {
    me: {
      todaySeconds, weekSeconds, daily, timesheet, recent,
      tasks: myTasks,
      overdue: myTasks.filter((t) => t.deadline && new Date(t.deadline) < now),
      upcoming: myTasks.filter((t) => t.deadline && new Date(t.deadline) >= now && new Date(t.deadline) <= soon),
    },
  };
  if (teamP) out.team = await teamP;
  res.json(out);
});
dashboard.get('/people', requireRole('owner'), async (req, res) => {
  const today = todayStr();
  const to = DAY.test(req.query.to || '') ? req.query.to : today;
  const from = DAY.test(req.query.from || '') ? req.query.from : weekStartOf(today);
  if (from > to) throw bad('"From" date must not be after "To" date');
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { days.push(d); if (days.length > 366) throw bad('Please pick a period of one year or less'); }
  const workdays = days.filter((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())).length;
  const capacity = workdays * HOURS_PER_DAY * 3600;

  const users = await User.find({ active: true, pending: { $ne: true }, role: { $ne: 'viewer' } }).select('name color title role').lean();
  const uid = users.map((u) => u._id);
  const rows = await TimeEntry.aggregate([
    { $match: { user: { $in: uid }, workDate: { $gte: from, $lte: to } } },
    { $group: { _id: { u: '$user', d: '$workDate', p: '$project', t: '$task', a: '$approvalStatus' }, s: { $sum: '$durationSeconds' } } },
  ]);
  const [projects, taskDocs, assigned, running] = await Promise.all([
    Project.find({ _id: { $in: [...new Set(rows.map((r) => String(r._id.p)))] } }).select('name color').lean(),
    Task.find({ _id: { $in: [...new Set(rows.map((r) => String(r._id.t)))] } }).select('title project').lean(),
    Task.find({ assignee: { $in: uid }, parent: null, status: { $ne: 'cancelled' } }).select('assignee status deadline estimateSeconds completedAt').lean(),
    TimerSession.find({ user: { $in: uid }, state: 'running' }).populate('task', 'title').populate('project', 'name').lean(),
  ]);
  const pById = new Map(projects.map((x) => [String(x._id), { id: String(x._id), name: x.name, color: x.color }]));
  const tById = new Map(taskDocs.map((x) => [String(x._id), x]));
  const now = new Date();
  const fromT = new Date(`${from}T00:00:00Z`), toT = new Date(`${addDays(to, 1)}T00:00:00Z`);

  const people = users.map((u) => {
    const id = String(u._id);
    const mine = rows.filter((r) => String(r._id.u) === id);
    const sum = (f) => mine.filter(f).reduce((a, r) => a + r.s, 0);
    const byDay = new Map();
    const byProject = new Map();
    const byTask = new Map();
    for (const r of mine) {
      byDay.set(r._id.d, (byDay.get(r._id.d) || 0) + r.s);
      byProject.set(String(r._id.p), (byProject.get(String(r._id.p)) || 0) + r.s);
      byTask.set(String(r._id.t), (byTask.get(String(r._id.t)) || 0) + r.s);
    }
    const seconds = sum(() => true);
    const my = assigned.filter((t) => String(t.assignee) === id);
    const open = my.filter((t) => t.status !== 'completed');
    const live = running.find((x) => String(x.user) === id);
    return {
      user: { id, name: u.name, color: u.color, title: u.title, role: u.role },
      seconds,
      byApproval: { approved: sum((r) => r._id.a === 'approved'), submitted: sum((r) => r._id.a === 'submitted'), draft: sum((r) => r._id.a === 'draft'), rejected: sum((r) => r._id.a === 'rejected') },
      activeDays: byDay.size,
      avgPerActiveDay: byDay.size ? Math.round(seconds / byDay.size) : 0,
      utilization: capacity ? seconds / capacity : 0,
      daily: days.map((d) => ({ date: d, seconds: byDay.get(d) || 0 })),
      byProject: [...byProject].map(([pid, s]) => ({ project: pById.get(pid), seconds: s })).filter((x) => x.project).sort((a, b) => b.seconds - a.seconds),
      topTasks: [...byTask].map(([tid, s]) => ({ task: tById.get(tid), seconds: s })).filter((x) => x.task)
        .sort((a, b) => b.seconds - a.seconds).slice(0, 5).map((x) => ({ id: String(x.task._id), title: x.task.title, project: pById.get(String(x.task.project)), seconds: x.seconds })),
      tasks: {
        open: open.length,
        overdue: open.filter((t) => t.deadline && new Date(t.deadline) < now).length,
        completed: my.filter((t) => t.status === 'completed' && t.completedAt && t.completedAt >= fromT && t.completedAt < toT).length,
        plannedSeconds: open.reduce((a, t) => a + (t.estimateSeconds || 0), 0),
      },
      now: live ? { task: live.task?.title || '', project: live.project?.name || '' } : null,
    };
  }).sort((a, b) => b.seconds - a.seconds || a.user.name.localeCompare(b.user.name));

  const total = people.reduce((a, p) => a + p.seconds, 0);
  res.json({
    from, to, workdays, hoursPerDay: HOURS_PER_DAY, capacitySeconds: capacity,
    totals: {
      seconds: total,
      people: people.length,
      tracking: people.filter((p) => p.seconds > 0).length,
      avgPerPerson: people.length ? Math.round(total / people.length) : 0,
      utilization: capacity && people.length ? total / (capacity * people.length) : 0,
      pending: people.reduce((a, p) => a + p.byApproval.submitted, 0),
    },
    people,
  });
});

// ----------------------------------------------------------------- reports
async function reportMatch(req) {
  const to = req.query.to || todayStr();
  const from = req.query.from || addDays(to, -29);
  if (from > to) throw bad('"From" date must not be after "To" date');
  const m = { workDate: { $gte: from, $lte: to } };
  if (req.query.project) m.project = (await Project.findById(req.query.project))?._id;
  if (req.query.user) m.user = (await User.findById(req.query.user))?._id;
  if (req.query.source) m.source = req.query.source;
  if (req.query.status) m.approvalStatus = req.query.status;
  // Scope by role: owner = everything, manager = own projects (+ own time), others = own time only.
  if (!isOwner(req.user)) {
    if (req.user.role === 'manager') {
      const managed = (await Project.find({ manager: req.user._id }).select('_id')).map((p) => p._id);
      m.$or = [{ user: req.user._id }, { project: { $in: managed } }];
    } else m.user = req.user._id;
  }
  return { m, from, to };
}

reports.get('/summary', async (req, res) => {
  const { m, from, to } = await reportMatch(req);
  const [r] = await TimeEntry.aggregate([
    { $match: m },
    { $facet: {
      total: [{ $group: { _id: null, s: { $sum: '$durationSeconds' }, n: { $sum: 1 } } }],
      byDay: [{ $group: { _id: '$workDate', s: { $sum: '$durationSeconds' } } }],
      byProject: [{ $group: { _id: '$project', s: { $sum: '$durationSeconds' } } }, { $sort: { s: -1 } }],
      byUser: [{ $group: { _id: '$user', s: { $sum: '$durationSeconds' } } }, { $sort: { s: -1 } }],
      byTask: [{ $group: { _id: '$task', s: { $sum: '$durationSeconds' } } }, { $sort: { s: -1 } }, { $limit: 10 }],
      bySource: [{ $group: { _id: '$source', s: { $sum: '$durationSeconds' } } }],
      byStatus: [{ $group: { _id: '$approvalStatus', s: { $sum: '$durationSeconds' }, n: { $sum: 1 } } }],
    } },
  ]);
  const [projects, users, taskDocs] = await Promise.all([
    Project.find({ _id: { $in: r.byProject.map((x) => x._id) } }).select('name color'),
    User.find({ _id: { $in: r.byUser.map((x) => x._id) } }).select('name color title'),
    Task.find({ _id: { $in: r.byTask.map((x) => x._id) } }).populate('project', 'name color').select('title project'),
  ]);
  const byDay = new Map(r.byDay.map((d) => [d._id, d.s]));
  const days = [];
  for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push({ date: d, seconds: byDay.get(d) || 0 });

  // estimate vs actual for the projects in scope (all-time actual so it is comparable with the estimate)
  const pIds = projects.map((p) => p._id);
  const per = await projectTotals(pIds);
  res.json({
    from, to,
    totalSeconds: r.total[0]?.s || 0,
    entryCount: r.total[0]?.n || 0,
    days,
    byProject: r.byProject.map((x) => ({ project: projects.find((p) => String(p._id) === String(x._id)), seconds: x.s })).filter((x) => x.project),
    byUser: r.byUser.map((x) => ({ user: users.find((u) => String(u._id) === String(x._id)), seconds: x.s })).filter((x) => x.user),
    byTask: r.byTask.map((x) => ({ task: taskDocs.find((t) => String(t._id) === String(x._id)), seconds: x.s })).filter((x) => x.task),
    bySource: Object.fromEntries(r.bySource.map((x) => [x._id, x.s])),
    byStatus: Object.fromEntries(r.byStatus.map((x) => [x._id, { seconds: x.s, count: x.n }])),
    estimateVsActual: projects.map((p) => ({ id: String(p._id), name: p.name, color: p.color, ...per.get(String(p._id)) })),
  });
});

reports.get('/export', async (req, res) => {
  const { m } = await reportMatch(req);
  const rows = await TimeEntry.find(m).sort({ workDate: 1, createdAt: 1 }).limit(20000)
    .populate('user', 'name').populate('project', 'name').populate('task', 'title parent');
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`; // neutralise CSV formula injection
  const head = ['Date', 'Employee', 'Project', 'Task', 'Hours', 'Seconds', 'Source', 'Approval', 'Description'];
  const lines = rows.map((e) => [e.workDate, e.user?.name, e.project?.name, e.task?.title, (e.durationSeconds / 3600).toFixed(2), e.durationSeconds, e.source, e.approvalStatus, e.description].map(q).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="time-report.csv"');
  res.send('﻿' + [head.map(q).join(','), ...lines].join('\r\n'));
});

// ----------------------------------------------------------------- notifications
notifications.get('/', async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(40);
  res.json({ items, unread: await Notification.countDocuments({ user: req.user._id, read: false }) });
});
notifications.post('/read', async (req, res) => {
  const filter = { user: req.user._id, read: false };
  if (req.body?.id) filter._id = req.body.id;
  await Notification.updateMany(filter, { read: true });
  res.json({ ok: true });
});

// ----------------------------------------------------------------- audit (owner only)
auditLog.get('/', requireRole('owner'), async (req, res) => {
  const { action, actor, project } = req.query;
  const f = {};
  if (action) f.action = new RegExp(`^${String(action).replace(/[^\w.]/g, '')}`);
  if (actor) f.actor = actor;
  if (project) f.project = project;
  res.json(await AuditEvent.find(f).populate('actor', 'name color').sort({ createdAt: -1 }).limit(200));
});
