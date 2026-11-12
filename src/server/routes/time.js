import { Router } from '../router.js';
import { Task, Project, TimeEntry, TimerSession, User } from '../models/index.js';
import {
  authenticate, bad, notFound, forbidden, audit, notify, HttpError,
  canTrack, canViewProject, taskVisible, taskBudget, isOwner, isProjectManager, workDateOf, todayStr, visibleProjectFilter,
} from '../util.js';

export const timer = Router();
export const timeEntries = Router();
timer.use(authenticate);
timeEntries.use(authenticate);

const sameId = (a, b) => a && b && String(a._id || a) === String(b._id || b);
const TIMER_POP = [
  { path: 'task', select: 'title parent status estimateSeconds', populate: { path: 'parent', select: 'title' } },
  { path: 'project', select: 'name color' },
];

/** Only the person a task is assigned to may track time on it (not collaborators, managers or the owner). */
function assertAssignee(user, task) {
  if (!task.assignee) throw bad('This task has no assignee yet. Assign it to someone before tracking time.');
  if (!sameId(task.assignee, user)) throw forbidden('Only the person this task is assigned to can track time on it.');
}

/** Time is tracked on SUBTASKS only. A parent task is a container: its time is the sum of its subtasks. */
async function assertTrackable(task) {
  if (task.parent) return;
  const hasSubtasks = await Task.exists({ parent: task._id });
  throw bad(hasSubtasks
    ? 'Time is tracked on subtasks. Open a subtask and start its timer.'
    : 'Time is tracked on subtasks. Add a subtask to this task first, then start the timer on the subtask.');
}

async function snapshot(userId, extra = {}) {
  const sessions = await TimerSession.find({ user: userId }).populate(TIMER_POP).sort({ updatedAt: -1 });
  return { serverNow: new Date().toISOString(), sessions, ...extra };
}

/** Atomically bank the elapsed running segment and mark the session paused (server clock only). */
const pauseRunning = (userId, now) =>
  TimerSession.findOneAndUpdate(
    { user: userId, state: 'running' },
    [{
      $set: {
        accumulatedSeconds: { $add: ['$accumulatedSeconds', { $max: [0, { $divide: [{ $subtract: [now, '$segmentStart'] }, 1000] }] }] },
        state: 'paused',
      },
    }],
    { returnDocument: 'after', updatePipeline: true },
  );

timer.get('/', async (req, res) => res.json(await snapshot(req.user._id)));

timer.post('/start', async (req, res) => {
  const { taskId, description } = req.body || {};
  const task = await Task.findById(taskId);
  if (!task) throw notFound('Task not found');
  const project = await Project.findById(task.project);
  if (!project || !canViewProject(req.user, project)) throw notFound('Task not found');
  if (!canTrack(req.user, project)) throw forbidden('You cannot track time on this project');
  if (!(await taskVisible(req.user, project, task))) throw notFound('Task not found');
  await assertTrackable(task);
  assertAssignee(req.user, task);
  if (['completed', 'cancelled'].includes(task.status)) throw bad('This work is already closed. Reopen it before tracking time.');
  const budget = await taskBudget(task);
  if (budget.exhausted) {
    const h = (s) => `${Math.round((s / 3600) * 100) / 100} h`;
    throw new HttpError(409, `The estimate for this task is fully used (${h(budget.total)} of ${h(budget.estimate)}). Ask your manager to increase the estimate before tracking more time.`, 'ESTIMATE_USED');
  }

  const now = new Date();
  const running = await TimerSession.findOne({ user: req.user._id, state: 'running' }).populate('task', 'title');
  if (running && sameId(running.task, task._id)) return res.json(await snapshot(req.user._id, { pausedPrevious: null })); // idempotent retry

  let pausedPrevious = null;
  if (running) {
    await pauseRunning(req.user._id, now);
    pausedPrevious = { taskId: String(running.task._id), title: running.task.title };
  }
  try {
    const resumed = await TimerSession.findOneAndUpdate(
      { user: req.user._id, task: task._id, state: 'paused' },
      { $set: { state: 'running', segmentStart: now, ...(description ? { description } : {}) } },
      { returnDocument: 'after' },
    );
    if (!resumed)
      await TimerSession.create({
        user: req.user._id, project: project._id, task: task._id, state: 'running',
        segmentStart: now, firstStartedAt: now, accumulatedSeconds: 0, description: description || '',
      });
  } catch (e) {
    if (e.code !== 11000) throw e;
    // Lost a race (double click / second device). If it ended up running on this task, that's success.
    const cur = await TimerSession.findOne({ user: req.user._id, state: 'running' });
    if (!cur || !sameId(cur.task, task._id)) throw new HttpError(409, 'Another timer started at the same moment. Please try again.', 'TIMER_CONFLICT');
  }
  if (task.status === 'todo') {
    task.status = 'in_progress';
    await task.save();
  }
  res.json(await snapshot(req.user._id, { pausedPrevious }));
});

timer.post('/pause', async (req, res) => {
  await pauseRunning(req.user._id, new Date()); // no-op if nothing runs => safe to retry
  res.json(await snapshot(req.user._id));
});

timer.post('/stop', async (req, res) => {
  const { taskId, description } = req.body || {};
  const filter = { user: req.user._id };
  if (taskId) filter.task = taskId;
  else filter.state = 'running';
  // findOneAndDelete is atomic, so a repeated/retried stop can never create a second entry.
  const s = await TimerSession.findOneAndDelete(filter);
  if (!s) return res.json(await snapshot(req.user._id, { entry: null, alreadyStopped: true }));
  const now = new Date();
  const total = s.accumulatedSeconds + (s.state === 'running' ? Math.max(0, (now - s.segmentStart) / 1000) : 0);
  const seconds = Math.round(total);
  let entry = null;
  if (seconds >= 1) {
    entry = await TimeEntry.create({
      user: req.user._id, project: s.project, task: s.task,
      workDate: workDateOf(s.firstStartedAt), // sessions are reported on the day they started
      startedAt: s.firstStartedAt, endedAt: now, durationSeconds: seconds,
      description: (description ?? s.description ?? '').trim(), source: 'timer', clientId: `timer-${s._id}`,
      history: [{ at: now, by: req.user._id, change: 'Recorded by timer' }],
    });
  }
  res.json(await snapshot(req.user._id, { entry: entry && (await entry.populate([{ path: 'task', select: 'title' }, { path: 'project', select: 'name color' }])) }));
});

timer.delete('/:taskId', async (req, res) => {
  await TimerSession.deleteOne({ user: req.user._id, task: req.params.taskId });
  res.json(await snapshot(req.user._id));
});

// ----------------------------------------------------------------- time entries
const ENTRY_POP = [
  { path: 'user', select: 'name color title' },
  { path: 'project', select: 'name color' },
  { path: 'task', select: 'title parent', populate: { path: 'parent', select: 'title' } },
];

async function managedProjectIds(user) {
  if (isOwner(user)) return null; // null = unrestricted
  const rows = await Project.find({ manager: user._id }).select('_id');
  return rows.map((r) => r._id);
}

async function entryScope(user) {
  const managed = await managedProjectIds(user);
  if (managed === null) return {};
  return { $or: [{ user: user._id }, { project: { $in: managed } }] };
}

timeEntries.get('/', async (req, res) => {
  const { from, to, user, project, task, status, source, mine } = req.query;
  const filter = { $and: [await entryScope(req.user)] };
  const f = {};
  if (mine === '1') f.user = req.user._id;
  else if (user) f.user = user;
  if (project) f.project = project;
  if (task) f.task = task;
  if (status) f.approvalStatus = status;
  if (source) f.source = source;
  if (from || to) f.workDate = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  filter.$and.push(f);
  const entries = await TimeEntry.find(filter).populate(ENTRY_POP).sort({ workDate: -1, createdAt: -1 }).limit(500);
  res.json({ entries, totalSeconds: entries.reduce((s, e) => s + e.durationSeconds, 0) });
});

async function validateAndTarget(req, b) {
  const task = await Task.findById(b.taskId);
  if (!task) throw notFound('Task not found');
  const project = await Project.findById(task.project);
  if (!project || !canViewProject(req.user, project)) throw notFound('Task not found');
  if (!canTrack(req.user, project)) throw forbidden('You cannot log time on this project');
  if (!(await taskVisible(req.user, project, task))) throw notFound('Task not found');
  await assertTrackable(task);
  assertAssignee(req.user, task);
  const seconds = Math.round(Number(b.durationSeconds));
  if (!Number.isFinite(seconds) || seconds < 60) throw bad('Duration must be at least 1 minute');
  if (seconds > 24 * 3600) throw bad('A single entry cannot exceed 24 hours');
  return { task, project, seconds };
}

// Time is recorded by the timer. The owner (or the project's manager) can add a CORRECTION entry on a subtask, for the
// person it is assigned to; it needs a reason, is marked as manual and is already approved.
timeEntries.post('/', async (req, res) => {
  const b = req.body || {};
  const task = await Task.findById(b.taskId);
  if (!task) throw notFound('Task not found');
  const project = await Project.findById(task.project);
  if (!project || !canViewProject(req.user, project)) throw notFound('Task not found');
  if (!isProjectManager(req.user, project)) throw forbidden('Manual time entries are turned off. Time is recorded by the timer; the owner or project manager can add a correction.');
  if (!task.parent) throw bad('Time is recorded on subtasks. Add the correction to a subtask.');
  if (!task.assignee) throw bad('This subtask has no assignee. Assign it to someone first.');
  const seconds = Math.round(Number(b.durationSeconds));
  if (!Number.isFinite(seconds) || seconds < 60) throw bad('Duration must be at least 1 minute');
  if (seconds > 24 * 3600) throw bad('A single entry cannot exceed 24 hours');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.workDate || '')) throw bad('Work date is required');
  if (b.workDate > todayStr()) throw bad('Work date cannot be in the future');
  const reason = String(b.description || '').trim();
  if (reason.length < 3) throw bad('Please give a reason for this correction');
  if (reason.length > 1000) throw bad('The reason is too long');
  if (b.clientId) {
    const dupe = await TimeEntry.findOne({ user: task.assignee, clientId: String(b.clientId) }).populate(ENTRY_POP);
    if (dupe) return res.json({ entry: dupe, duplicate: true }); // network retry => same result, no duplicate
  }
  const now = new Date();
  const entry = await TimeEntry.create({
    user: task.assignee, project: project._id, task: task._id, workDate: b.workDate, durationSeconds: seconds,
    description: reason, source: 'manual', approvalStatus: 'approved', reviewedBy: req.user._id, reviewedAt: now,
    clientId: b.clientId ? String(b.clientId) : undefined,
    history: [{ at: now, by: req.user._id, change: `CORRECTION added by ${req.user.name}: ${reason}` }],
  });
  await audit(req.user, 'time.create', 'TimeEntry', entry, `Correction: added ${Math.round(seconds / 60)} min on "${task.title}" (${reason})`, { project: project._id, reason });
  res.status(201).json({ entry: await entry.populate(ENTRY_POP) });
});

async function loadEntry(req) {
  const e = await TimeEntry.findById(req.params.id);
  if (!e) throw notFound('Time entry not found');
  const project = await Project.findById(e.project);
  const mine = sameId(e.user, req.user);
  const manages = project && isProjectManager(req.user, project);
  if (!mine && !manages) throw notFound('Time entry not found');
  return { e, project, mine, manages };
}

timeEntries.patch('/:id', async (req, res) => {
  const { e, project, mine, manages } = await loadEntry(req);
  const b = req.body || {};
  const approved = e.approvalStatus === 'approved';
  // Tracked time is changed by the owner / project manager only. A team member can still fix the description of their own entry.
  const touchesTime = (b.durationSeconds !== undefined && Math.round(Number(b.durationSeconds)) !== e.durationSeconds)
    || (b.workDate !== undefined && b.workDate !== e.workDate) || (b.taskId && String(b.taskId) !== String(e.task));
  if (touchesTime && !manages) throw forbidden('Only the owner or project manager can change tracked time.');
  // Approved records are never silently changed: only the owner, with a recorded reason.
  if (approved && !(isOwner(req.user) && b.reason?.trim())) throw forbidden('Approved entries are locked. The owner can correct them with a reason.');
  if (e.approvalStatus === 'submitted' && mine && !isOwner(req.user)) throw forbidden('Entry is awaiting review. Ask the reviewer to request a correction.');
  const changes = [];
  if (b.description !== undefined && b.description !== e.description) { e.description = String(b.description).trim(); changes.push('description'); }
  if (b.durationSeconds !== undefined) {
    const s = Math.round(Number(b.durationSeconds));
    if (!Number.isFinite(s) || s < 60 || s > 86400) throw bad('Duration must be between 1 minute and 24 hours');
    if (s !== e.durationSeconds) { changes.push(`duration ${Math.round(e.durationSeconds / 60)}m → ${Math.round(s / 60)}m`); e.durationSeconds = s; }
  }
  if (b.workDate !== undefined && b.workDate !== e.workDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.workDate) || b.workDate > todayStr()) throw bad('Invalid work date');
    changes.push(`date ${e.workDate} → ${b.workDate}`);
    e.workDate = b.workDate;
  }
  if (b.taskId && String(b.taskId) !== String(e.task)) {
    const t = await validateAndTarget(req, { taskId: b.taskId, durationSeconds: e.durationSeconds });
    e.task = t.task._id;
    e.project = t.project._id;
    changes.push('task changed');
  }
  if (!changes.length) return res.json({ entry: await e.populate(ENTRY_POP) });
  e.history.push({ at: new Date(), by: req.user._id, change: `${approved ? 'CORRECTION (' + b.reason.trim() + '): ' : ''}${changes.join(', ')}` });
  if (e.approvalStatus === 'rejected') e.approvalStatus = 'draft';
  await e.save();
  await audit(req.user, approved ? 'time.correct' : 'time.update', 'TimeEntry', e, `Entry edited: ${changes.join(', ')}`, { project: project?._id, reason: b.reason });
  res.json({ entry: await e.populate(ENTRY_POP) });
});

timeEntries.delete('/:id', async (req, res) => {
  const { e, project, manages } = await loadEntry(req);
  if (!manages) throw forbidden('Only the owner or project manager can delete tracked time.');
  const reason = String(req.query.reason || '').trim();
  if (!['draft', 'rejected'].includes(e.approvalStatus) && !(isOwner(req.user) && reason.length >= 3))
    throw forbidden('Only the owner can delete a submitted or approved entry, and a reason is required.');
  await e.deleteOne();
  await audit(req.user, 'time.delete', 'TimeEntry', e, `Deleted ${Math.round(e.durationSeconds / 60)} min entry${reason ? ` (${reason})` : ''}`, { project: project?._id, reason });
  res.json({ ok: true });
});

timeEntries.post('/submit', async (req, res) => {
  const { ids, from, to } = req.body || {};
  const filter = { user: req.user._id, approvalStatus: { $in: ['draft', 'rejected'] } };
  if (ids?.length) filter._id = { $in: ids };
  else if (from && to) filter.workDate = { $gte: from, $lte: to };
  else throw bad('Select entries or a date range to submit');
  const rows = await TimeEntry.find(filter);
  if (!rows.length) throw bad('Nothing to submit');
  await TimeEntry.updateMany({ _id: { $in: rows.map((r) => r._id) } }, {
    $set: { approvalStatus: 'submitted', reviewNote: null },
    $push: { history: { at: new Date(), by: req.user._id, change: 'Submitted for review' } },
  });
  const projects = await Project.find({ _id: { $in: rows.map((r) => r.project) } });
  const approvers = await User.find({ active: true, role: 'owner' });
  for (const a of approvers) {
    if (sameId(a, req.user)) continue;
    const relevant = isOwner(a) || projects.some((p) => canViewProject(a, p));
    if (relevant) await notify(a._id, `${req.user.name} submitted ${rows.length} time entr${rows.length > 1 ? 'ies' : 'y'} for review`, '/approvals');
  }
  await audit(req.user, 'time.submit', 'TimeEntry', rows[0], `Submitted ${rows.length} entries`, { count: rows.length });
  res.json({ submitted: rows.length });
});

async function reviewableFilter(user) {
  if (!isOwner(user)) throw forbidden('Only the admin can review and approve time.');
  return {};
}

timeEntries.get('/approvals/queue', async (req, res) => {
  const scope = await reviewableFilter(req.user);
  const status = req.query.status || 'submitted';
  const entries = await TimeEntry.find({ ...scope, approvalStatus: status, user: { $ne: req.user._id } })
    .populate(ENTRY_POP).sort({ workDate: -1, createdAt: -1 }).limit(500);
  res.json({ entries });
});

timeEntries.post('/approvals/review', async (req, res) => {
  const { ids = [], decision, note = '' } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) throw bad('Decision must be approved or rejected');
  if (decision === 'rejected' && !note.trim()) throw bad('Please explain what needs to be corrected');
  const scope = await reviewableFilter(req.user);
  const filter = { ...scope, _id: { $in: ids }, approvalStatus: 'submitted' };
  if (!isOwner(req.user)) filter.user = { $ne: req.user._id }; // nobody approves their own time (except owner)
  const rows = await TimeEntry.find(filter);
  if (!rows.length) throw bad('No reviewable entries selected');
  const now = new Date();
  await TimeEntry.updateMany({ _id: { $in: rows.map((r) => r._id) } }, {
    $set: { approvalStatus: decision, reviewNote: note.trim(), reviewedBy: req.user._id, reviewedAt: now },
    $push: { history: { at: now, by: req.user._id, change: `${decision}${note ? ': ' + note.trim() : ''}` } },
  });
  const byUser = new Map();
  rows.forEach((r) => byUser.set(String(r.user), (byUser.get(String(r.user)) || 0) + 1));
  for (const [uid, n] of byUser)
    await notify(uid, `${n} time entr${n > 1 ? 'ies were' : 'y was'} ${decision} by ${req.user.name}${note ? ` — “${note.trim()}”` : ''}`, '/time');
  await audit(req.user, `time.${decision}`, 'TimeEntry', rows[0], `${decision} ${rows.length} entries`, { count: rows.length, note });
  res.json({ reviewed: rows.length });
});
