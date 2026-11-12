import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User, AuditEvent, Notification, Task, TimeEntry } from './models/index.js';

export const COMPANY_TZ = process.env.COMPANY_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ });
/** Work date (YYYY-MM-DD) of an instant, in the company timezone. */
export const workDateOf = (d) => dayFmt.format(d);
export const todayStr = () => workDateOf(new Date());
export const addDays = (str, n) => {
  const d = new Date(`${str}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (m, code) => new HttpError(400, m, code);
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);

export const signToken = (user) => jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '7d' });

export async function authenticate(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new HttpError(401, 'Session expired, please sign in again');
    }
    const user = await User.findById(payload.sub);
    if (!user || !user.active) throw new HttpError(401, 'Account is deactivated');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden());

const eq = (a, b) => a && b && String(a._id || a) === String(b._id || b);
export const isOwner = (u) => u.role === 'owner';
export const isProjectManager = (u, p) => isOwner(u) || eq(p.manager, u);
export const isMember = (u, p) => (p.members || []).some((m) => eq(m, u));
export const isLead = (u, p) => eq(p.lead, u);
export const canViewProject = (u, p) => isProjectManager(u, p) || isMember(u, p);
/** Can this user run timers / log time in the project? Viewers are read-only. */
export const canTrack = (u, p) => u.role !== 'viewer' && canViewProject(u, p) && !['completed', 'archived'].includes(p.status);
export const canCoordinate = (u, p) => isProjectManager(u, p) || isLead(u, p);

/** Work assigned to (or shared with) the user. */
export const mineTask = (u, t) => eq(t.assignee, u) || (!!t.createdBy && eq(t.createdBy, u)) || (t.collaborators || []).some((c) => eq(c, u));
/** Owner, project manager/lead and read-only viewers see all work in a project; everyone else sees only their own. */
export const seesAllTasks = (u, p) => canCoordinate(u, p) || u.role === 'viewer';
/**
 * Can this user see this task? Team members see work assigned to them, all subtasks of a task they own,
 * and the parent task of any subtask assigned to them (for context).
 */
export async function taskVisible(u, p, t) {
  if (t.restricted && u.role !== 'owner') return false; // card assigned to a not-yet-approved Trello member: admin only
  if (seesAllTasks(u, p) || mineTask(u, t)) return true;
  if (t.parent) {
    const par = await Task.findById(t.parent).select('assignee collaborators');
    return !!par && mineTask(u, par);
  }
  return !!(await Task.exists({ parent: t._id, $or: [{ assignee: u._id }, { collaborators: u._id }] }));
}

export const visibleProjectFilter = (u) => (isOwner(u) ? {} : { $or: [{ manager: u._id }, { members: u._id }] });

export async function audit(actor, action, entityType, entity, summary, meta = {}) {
  try {
    await AuditEvent.create({
      actor: actor?._id,
      action,
      entityType,
      entityId: String(entity?._id || entity),
      project: meta.project,
      summary,
      meta,
    });
  } catch (e) {
    console.error('audit failed', e.message); // auditing must never break the user's action
  }
}

export async function notify(userId, text, link = '') {
  try {
    if (userId) await Notification.create({ user: userId, text, link });
  } catch (e) {
    console.error('notify failed', e.message); // notification failure must not affect data integrity
  }
}

/**
 * Time + estimate roll-ups per task.
 *  direct   = time recorded on the task itself
 *  children = time recorded on its subtasks
 *  total    = direct + children          (each time entry is counted exactly once)
 *  estimate = parent's own estimate if set (it is inclusive), else the sum of subtask estimates, else null
 */
export function computeTotals(tasks, secondsByTask) {
  const kids = new Map();
  for (const t of tasks) if (t.parent) kids.set(String(t.parent), [...(kids.get(String(t.parent)) || []), t]);
  const out = new Map();
  for (const t of tasks) {
    const id = String(t._id);
    const direct = secondsByTask.get(id) || 0;
    const subs = kids.get(id) || [];
    const children = subs.reduce((s, c) => s + (secondsByTask.get(String(c._id)) || 0), 0);
    const subEst = subs.filter((c) => c.estimateSeconds != null);
    let estimate = t.estimateSeconds;
    if (estimate == null && subEst.length) estimate = subEst.reduce((s, c) => s + c.estimateSeconds, 0);
    const active = subs.filter((c) => c.status !== 'cancelled');
    const done = active.filter((c) => c.status === 'completed').length;
    let progress;
    if (t.parent || !active.length) progress = t.status === 'completed' ? 100 : 0;
    else progress = Math.round((done / active.length) * 100);
    if (!t.parent && active.length && t.status === 'completed') progress = 100;
    // derived = the estimate is the total of its subtasks' estimates; then only SUBTASK time counts against it
    const derived = active.some((c) => c.estimateSeconds != null);
    out.set(id, { direct, children, total: direct + children, estimate, derived, used: derived ? children : direct + children, subtaskCount: active.length, subtaskDone: done, progress });
  }
  return out;
}

const toOid = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));

export async function secondsByTask(match) {
  // Aggregation pipelines do NOT auto-cast strings to ObjectIds (queries do), so cast project ids explicitly.
  const m = { ...match };
  if (m.project?.$in) m.project = { $in: m.project.$in.map(toOid) };
  else if (m.project) m.project = toOid(m.project);
  if (m.task?.$in) m.task = { $in: m.task.$in.map(toOid) };
  const rows = await TimeEntry.aggregate([{ $match: m }, { $group: { _id: '$task', s: { $sum: '$durationSeconds' } } }]);
  return new Map(rows.map((r) => [String(r._id), r.s]));
}

/**
 * Is the estimate used up? True when nothing meaningful is left: used >= estimate, or less than one minute remains
 * (durations are shown to the minute, so "<1 m remaining" is treated as fully used). An explicit 0 h estimate never blocks.
 */
export function estimateUsedUp(total, estimate) {
  if (estimate == null || estimate <= 0) return false;
  const remaining = estimate - total;
  return remaining <= 0 || (estimate >= 120 && remaining < 60);
}

/** Saved effort vs estimate for one task (parent totals include subtasks), same maths as everywhere else. */
export async function taskBudget(task) {
  // Only this task and its subtasks matter for its own numbers (loading the whole project made every timer start slower).
  const tasks = await Task.find({ $or: [{ _id: task._id }, { parent: task._id }] }).select('parent estimateSeconds status').lean();
  const totals = computeTotals(tasks, await secondsByTask({ task: { $in: tasks.map((t) => t._id) } }));
  const t = totals.get(String(task._id)) || { total: 0, used: 0, estimate: null };
  return { total: t.used, estimate: t.estimate, exhausted: estimateUsedUp(t.used, t.estimate) };
}

export async function projectTotals(projectIds) {
  const [tasks, secs] = await Promise.all([
    Task.find({ project: { $in: projectIds } }).lean(),
    secondsByTask({ project: { $in: projectIds } }),
  ]);
  const totals = computeTotals(tasks, secs);
  const per = new Map();
  for (const id of projectIds) per.set(String(id), { actual: 0, estimate: 0, tasks: 0, done: 0, overdue: 0, byStatus: {} });
  const now = new Date();
  for (const t of tasks) {
    const p = per.get(String(t.project));
    if (!p) continue;
    const tt = totals.get(String(t._id));
    p.actual += tt.direct; // sum of ALL entries once => no double counting of parent summaries
    if (!t.parent) {
      p.tasks += 1;
      if (t.status === 'completed') p.done += 1;
      if (tt.estimate != null) p.estimate += tt.estimate;
    }
    if (t.status !== 'completed' && t.status !== 'cancelled' && t.deadline && t.deadline < now) p.overdue += 1;
    p.byStatus[t.status] = (p.byStatus[t.status] || 0) + 1;
  }
  return per;
}
