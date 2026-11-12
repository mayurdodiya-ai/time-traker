import { Router } from '../router.js';
import { Task, Project, User, TimeEntry, TimerSession, Comment, AuditEvent, TrelloActivity, TASK_STATUSES, PRIORITIES } from '../models/index.js';
import {
  authenticate, bad, notFound, forbidden, audit, notify, HttpError,
  isMember, isOwner, canViewProject, canCoordinate, workDateOf, todayStr, isProjectManager, visibleProjectFilter, computeTotals, secondsByTask,
  mineTask, seesAllTasks, taskVisible, taskBudget,
} from '../util.js';
import { parseSheet, resolveRows, buildTemplate } from '../taskImport.js';
import { requireRole } from '../util.js';
import { pushTask, createCardFor, archiveCardFor, isLinked } from '../trelloSync.js';
import { tUploadAttachment, tAddComment, tPut, tDel } from '../trello.js';

export const tasks = Router();
tasks.use(authenticate);

const USER_FIELDS = 'name color title';
const POP = [
  { path: 'assignee', select: USER_FIELDS },
  { path: 'collaborators', select: USER_FIELDS },
  { path: 'project', select: 'name color status' },
];

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameId = (a, b) => a && b && String(a._id || a) === String(b._id || b);
/** A task a team member added for themselves: they may edit and delete it. */
/** The owner of a parent task (the person assigned to it, or any other person assigned to it) may manage the subtasks under it. */
async function ownsParentOf(user, task) {
  if (!task.parent || user.role === 'viewer') return false;
  const par = await Task.findById(task.parent._id || task.parent).select('assignee collaborators').lean();
  return !!par && (sameId(par.assignee, user) || (par.collaborators || []).some((c) => sameId(c, user)));
}
const ownTask = (user, task) => sameId(task.createdBy, user) && sameId(task.assignee, user);

/** Labels of a Trello-linked project, picked by their Trello ids. */
const pickLabels = (project, ids) => (project.trello?.labels || []).filter((l) => (ids || []).includes(l.id)).map((l) => ({ trelloId: l.id, name: l.name, color: l.color }));

const hrs = (s) => `${Math.round((s / 3600) * 100) / 100} h`;

const countedSubtasks = (parentId) => ({ parent: parentId, status: { $ne: 'cancelled' }, estimateSeconds: { $ne: null } });
const hasEstimatedSubtasks = (parentId) => Task.exists(countedSubtasks(parentId));

/**
 * A task that has subtasks with estimates gets its estimate from them: parent = sum of its (non-cancelled) subtasks.
 * Called whenever a subtask is created, re-estimated, cancelled/reopened or deleted.
 */
async function syncParentEstimate(parentId, actor, projectId) {
  if (!parentId) return;
  const parent = await Task.findById(parentId).select('title estimateSeconds').lean();
  if (!parent) return;
  const rows = await Task.find(countedSubtasks(parentId)).select('estimateSeconds').lean();
  if (!rows.length) return; // no estimated subtasks left: keep whatever the task had
  const sum = rows.reduce((s, r) => s + r.estimateSeconds, 0);
  if (parent.estimateSeconds === sum) return;
  await Task.updateOne({ _id: parentId }, { estimateSeconds: sum });
  await audit(actor, 'task.update', 'Task', parentId, `${parent.title}: estimate ${parent.estimateSeconds == null ? 'none' : hrs(parent.estimateSeconds)} → ${hrs(sum)} (total of subtasks)`, { project: projectId });
}

/**
 * "Also update tracked time": make a subtask's tracked time equal `target` seconds, through real time entries.
 *  - more time wanted  -> one (or several, max 24 h each) approved correction entries for the assignee
 *  - less time wanted  -> time is taken off the most recent entries first (an entry that is used up completely is deleted)
 * Everything is validated up front and nothing is changed here: the returned function applies the plan and returns a log line.
 * Submitted / approved entries can only be lowered by the owner.
 */
async function planTrackedSync(task, target, actor) {
  const entries = await TimeEntry.find({ task: task._id }).sort({ workDate: -1, createdAt: -1 });
  const total = entries.reduce((s, e) => s + e.durationSeconds, 0);
  const delta = target - total;
  if (delta === 0) return null;
  const owner = isOwner(actor);
  const note = `CORRECTION by ${actor.name}: tracked time set to match the new estimate`;
  if (delta > 0) {
    const assignee = task.assignee?._id || task.assignee;
    if (!assignee) throw bad('This subtask has no assignee, so tracked time cannot be added. Assign it first, or untick "Also set tracked time".');
    return async () => {
      const now = new Date();
      for (let left = delta; left > 0; left -= 86400) {
        await TimeEntry.create({
          user: assignee, project: task.project?._id || task.project, task: task._id, workDate: todayStr(), durationSeconds: Math.min(left, 86400),
          description: 'Set to match the new estimate', source: 'manual', approvalStatus: 'approved', reviewedBy: actor._id, reviewedAt: now,
          history: [{ at: now, by: actor._id, change: note }],
        });
      }
      return `tracked ${hrs(total)} → ${hrs(target)}`;
    };
  }
  let need = -delta;
  const steps = [];
  for (const e of entries) {
    if (need <= 0) break;
    if (!['draft', 'rejected'].includes(e.approvalStatus) && !owner) throw forbidden('Some of this time is already submitted or approved. Only the owner can lower it.');
    if (need >= e.durationSeconds) { steps.push({ e, remove: true }); need -= e.durationSeconds; } else { steps.push({ e, to: e.durationSeconds - need }); need = 0; }
  }
  return async () => {
    const now = new Date();
    for (const s of steps) {
      if (s.remove) await s.e.deleteOne();
      else { s.e.history.push({ at: now, by: actor._id, change: `${note} (${hrs(s.e.durationSeconds)} → ${hrs(s.to)})` }); s.e.durationSeconds = s.to; await s.e.save(); }
    }
    return `tracked ${hrs(total)} → ${hrs(target)}`;
  };
}

/**
 * Auto-completes a parent task once every required subtask is done, and reopens it if one becomes un-done again —
 * mirrors Trello boards, where finishing every checklist item marks the card complete. Cancelled parents are left alone.
 */
async function syncParentCompletion(parentId, actor, project) {
  if (!parentId) return;
  const parent = await Task.findById(parentId);
  if (!parent || parent.status === 'cancelled') return;
  if (!(await Task.exists({ parent: parentId }))) return; // no subtasks left to judge completion by
  // Every subtask counts here (not just "required" ones) — Trello-synced checklist items are never marked required,
  // but every checklist item still has to be checked off before the card itself should read as done.
  const open = await Task.countDocuments({ parent: parentId, status: { $nin: ['completed', 'cancelled'] } });
  if (open === 0 && parent.status !== 'completed') {
    parent.status = 'completed';
    parent.completedAt = new Date();
    await parent.save();
    await audit(actor, 'task.update', 'Task', parent, `${parent.title}: auto-completed — all subtasks are done`, { project: project._id });
    await pushTask(parent, project, { status: true });
  } else if (open > 0 && parent.status === 'completed') {
    parent.status = 'in_progress';
    parent.completedAt = null;
    await parent.save();
    await audit(actor, 'task.update', 'Task', parent, `${parent.title}: auto-reopened — a subtask is no longer done`, { project: project._id });
    await pushTask(parent, project, { status: true });
  }
}

async function attachTotals(docs) {
  if (!docs.length) return [];
  // A board / long list needs the whole project; one task (or a task with its subtasks) only needs its own family. This is what makes
  // opening a task fast: it no longer reads every task and every time entry of the project.
  const whole = docs.length > 25;
  // Read-only "who has a timer on this right now (running or paused-but-unsaved)" info, visible to anyone who can see the task.
  const liveQ = TimerSession.find({ task: { $in: docs.map((d) => d._id) } })
    .populate('user', USER_FIELDS).select('task user state segmentStart accumulatedSeconds');
  let all;
  let secs;
  let live;
  if (whole) {
    const projectIds = [...new Set(docs.map((d) => String(d.project._id || d.project)))];
    [all, secs, live] = await Promise.all([
      Task.find({ project: { $in: projectIds } }).select('parent estimateSeconds status project').lean(),
      secondsByTask({ project: { $in: projectIds } }),
      liveQ,
    ]);
  } else {
    const ids = docs.map((d) => d._id);
    [all, live] = await Promise.all([
      Task.find({ $or: [{ _id: { $in: ids } }, { parent: { $in: ids } }] }).select('parent estimateSeconds status project').lean(),
      liveQ,
    ]);
    secs = await secondsByTask({ task: { $in: all.map((x) => x._id) } });
  }
  const totals = computeTotals(all, secs);
  const liveByTask = new Map(live.map((r) => [String(r.task), r]));
  return docs.map((d) => {
    const r = liveByTask.get(String(d._id));
    return {
      ...d.toJSON(),
      totals: totals.get(String(d._id)),
      runningTimer: r ? { userId: String(r.user._id), userName: r.user.name, state: r.state, segmentStart: r.segmentStart, accumulatedSeconds: r.accumulatedSeconds } : null,
    };
  });
}

/** Admin only: names of Trello card members who have an access request that is still waiting for approval. */
async function addWaiting(user, rows) {
  if (user.role !== 'owner') return rows;
  const pending = await User.find({ pending: true, trelloMemberId: { $ne: null } }).select('name trelloMemberId').lean();
  if (!pending.length) return rows;
  const byTrello = new Map(pending.map((u) => [u.trelloMemberId, u.name]));
  return rows.map((r) => {
    const waiting = (r.trello?.snapshot?.idMembers || []).map((id) => byTrello.get(id)).filter(Boolean);
    return waiting.length ? { ...r, waiting } : r;
  });
}

async function loadTask(req, populate = true) {
  let q = Task.findById(req.params.id);
  if (populate) q = q.populate(POP);
  const task = await q;
  if (!task) throw notFound('Task not found');
  const project = await Project.findById(task.project._id || task.project);
  if (!project || !canViewProject(req.user, project)) throw notFound('Task not found');
  if (!(await taskVisible(req.user, project, task))) throw notFound('Task not found'); // employees only see their own work
  return { task, project };
}

async function assertAssignable(project, userId) {
  if (!userId) return;
  if (!isMember(userId, project) && !sameId(project.manager, userId))
    throw bad('Work can only be assigned to members of the project team');
  const u = await User.findById(userId).select('role active pending trelloMemberId');
  const waitingTrello = !!u && u.pending && !!u.trelloMemberId; // a Trello person waiting for approval can already hold work
  if (!(u?.active || waitingTrello) || u.role === 'viewer') throw bad('That user cannot be assigned work (inactive or read-only)');
}

tasks.get('/', async (req, res) => {
  const { project, assignee, status, priority, q, parent, overdue, mine } = req.query;
  const visible = await Project.find(visibleProjectFilter(req.user)).select('_id manager lead members');
  const filter = { project: { $in: visible.map((p) => p._id) } };
  if (req.user.role !== 'owner') filter.restricted = { $ne: true }; // cards held for unapproved Trello members: admin only
  if (project) filter.project = visible.some((p) => String(p._id) === project) ? project : null;
  if (assignee) filter.assignee = assignee;
  if (mine === '1') filter.$or = [{ assignee: req.user._id }, { collaborators: req.user._id }];
  if (status) filter.status = { $in: String(status).split(',') };
  if (priority) filter.priority = priority;
  if (q) {
    const num = /^(?:chr-|#)?(\d{1,9})$/i.exec(String(q).trim()); // "CHR-12", "#12" or "12" also finds ticket 12
    filter.$and = [...(filter.$and || []), { $or: [{ title: new RegExp(escapeRe(q), 'i') }, { ticketCode: new RegExp(`^${escapeRe(String(q).trim())}`, 'i') }, ...(num ? [{ ticketNumber: Number(num[1]) }] : [])] }];
  }
  if (parent === 'none') filter.parent = null;
  else if (parent) filter.parent = parent;
  if (overdue === '1') {
    filter.deadline = { $lt: new Date() };
    filter.status = { $nin: ['completed', 'cancelled'] };
  }
  // Visibility: all work in projects the user coordinates (or views); only their own work elsewhere.
  const fullIds = visible.filter((p) => seesAllTasks(req.user, p)).map((p) => p._id);
  const limitedIds = visible.filter((p) => !seesAllTasks(req.user, p)).map((p) => p._id);
  const scopes = [{ project: { $in: fullIds } }];
  if (limitedIds.length) {
    const pool = await Task.find({ project: { $in: limitedIds } }).select('parent assignee collaborators createdBy').lean();
    const mineIds = new Set(pool.filter((x) => mineTask(req.user, x)).map((x) => String(x._id)));
    const seen = new Set();
    for (const x of pool) {
      if (mineIds.has(String(x._id))) { seen.add(String(x._id)); if (x.parent) seen.add(String(x.parent)); } // my subtask => show its parent for context
      if (x.parent && mineIds.has(String(x.parent))) seen.add(String(x._id)); // my task => show all of its subtasks
    }
    scopes.push({ _id: { $in: [...seen] } });
  }
  const docs = await Task.find({ $and: [filter, { $or: scopes }] }).populate(POP).sort({ order: 1, createdAt: 1 }).limit(1000);
  res.json(await addWaiting(req.user, await attachTotals(docs)));
});

tasks.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.title?.trim()) throw bad('Title is required');
  let parent = null;
  let projectId = b.project;
  if (b.parent) {
    parent = await Task.findById(b.parent);
    if (!parent) throw notFound('Parent task not found');
    if (parent.parent) throw bad('Subtasks cannot be nested further in this version');
    projectId = parent.project; // a subtask always lives in its parent's project
  }
  const project = await Project.findById(projectId);
  if (!project || !canViewProject(req.user, project)) throw notFound('Project not found');
  const coordinator = canCoordinate(req.user, project);
  if (parent && !coordinator && !(await taskVisible(req.user, project, parent))) throw notFound('Parent task not found'); // you cannot add to a task you cannot see
  const subtaskOfMine = !!parent && req.user.role !== 'viewer' && (sameId(parent.assignee, req.user) || (parent.collaborators || []).some((c) => sameId(c, req.user)));
  // Any team member (not viewers) may add work and assign it to anyone on the project team (assertAssignable below checks that).
  // Someone who assigns a ticket to a colleague keeps sight of it (creators can see what they created).
  const selfOnly = !coordinator && !subtaskOfMine;
  if (selfOnly) {
    if (req.user.role === 'viewer' || !isMember(req.user, project)) throw forbidden('You can only add tasks to projects you are a team member of');
    if (parent) { b.assignee = req.user._id; b.collaborators = []; } // a subtask of someone else's task is still only for yourself
    else if (!b.assignee) b.assignee = req.user._id;
  }
  if (['completed', 'archived'].includes(project.status)) throw bad(`Project is ${project.status}`);
  await assertAssignable(project, b.assignee);
  if (!parent) for (const c of b.collaborators || []) await assertAssignable(project, c);
  if (b.status && !TASK_STATUSES.includes(b.status)) throw bad('Invalid status');
  if (b.priority && !PRIORITIES.includes(b.priority)) throw bad('Invalid priority');
  if (b.deadline && String(b.deadline).slice(0, 10) < todayStr()) throw bad('Deadline cannot be in the past');
  // hours on a subtask: owner, project manager, whoever owns the parent task, or the person the subtask is for (they own it)
  if (!coordinator && !subtaskOfMine && !(parent && sameId(b.assignee, req.user))) b.estimateSeconds = null;
  const task = await createTask({ actor: req.user, project, parent, data: b });
  const fresh = await Task.findById(task._id).populate(POP);
  res.status(201).json((await attachTotals([fresh]))[0]);
});

/**
 * Creates a task or subtask (the caller has already checked permissions and validated the data).
 * Shared by POST /tasks and the Excel import so both follow exactly the same rules: order, Trello card / checklist item,
 * audit trail and assignee notification.
 * `notifyAssignee: false` lets bulk callers send one summary notification instead of one per task.
 */
async function createTask({ actor, project, parent, data: b, notifyAssignee = true }) {
  const last = await Task.findOne({ project: project._id, parent: parent?._id || null }).sort({ order: -1 }).select('order');
  // Chronos-only: a task made in a Chronos-only list, or created with "Also create in Trello" switched off. It has no Trello card.
  const hasBoard = !parent && !!project.trello?.boardId;
  const localList = !parent && b.stageId ? (project.localLists || []).find((l) => l.id === b.stageId) : null; // custom list (any project)
  const trelloList = hasBoard && b.stageId ? (project.trello.lists || []).find((l) => l.id === b.stageId) : null;
  const chronosOnly = hasBoard && (!!localList || b.inTrello === false);
  const target = localList || trelloList || (chronosOnly ? (project.trello.lists || [])[0] : null); // the list a Chronos-only task shows in
  const stageName = chronosOnly ? target?.name : !parent && isLinked(project) ? trelloList?.name : undefined;
  const task = await Task.create({
    project: project._id, parent: parent?._id || null, title: b.title.trim(),
    description: b.description || '', criteria: b.criteria || '',
    assignee: b.assignee || null, collaborators: parent ? [] : b.collaborators || [], // a subtask has exactly one person
    status: b.status || 'todo', priority: b.priority || 'medium',
    ...(b.status === 'completed' ? { completedAt: new Date() } : {}),
    deadline: b.deadline || null,
    estimateSeconds: parent && b.estimateSeconds !== '' && b.estimateSeconds != null ? Number(b.estimateSeconds) : null, // hours live on subtasks; a task's hours are the total of its subtasks
    required: b.required !== false, createdBy: actor._id, order: (last?.order ?? -1) + 1,
    labels: parent ? [] : pickLabels(project, b.labelIds),
    ...(stageName ? { stage: stageName } : {}),
    ...(chronosOnly ? { chronosOnly: true, localStage: target?.id || null } : {}),
    ...(!chronosOnly && localList ? { localStage: localList.id, stage: localList.name } : {}), // no Trello: it just shows in that column
  });
  if (!parent && isLinked(project) && !chronosOnly) await createCardFor(task, project, b.stageId); // new task => new Trello card
  // Subtasks (hours, points, time tracking) are internal: they are never sent to Trello as checklist items.
  if (parent) await syncParentEstimate(parent._id, actor, project._id);
  await audit(actor, parent ? 'subtask.create' : 'task.create', 'Task', task, `Created ${parent ? 'subtask' : 'task'} "${task.title}"`, { project: project._id });
  if (notifyAssignee && task.assignee && !sameId(task.assignee, actor))
    await notify(task.assignee, `${actor.name} assigned you "${task.title}"`, `/projects/${project._id}?task=${task._id}`);
  if (notifyAssignee) for (const c of task.collaborators || []) if (!sameId(c, actor)) await notify(c, `${actor.name} added you to "${task.title}"`, `/projects/${project._id}?task=${task._id}`);
  return task;
}

// ----------------------------------------------------------------- Excel import (admin only)
const IMPORT_CHUNK_MAX = 25; // rows per commit request (the client sends smaller chunks for Trello-linked boards)
const XLSX_MAX_BYTES = 5 * 1024 * 1024;

async function importProject(id) {
  const project = await Project.findById(id);
  if (!project) throw notFound('Project not found');
  if (['completed', 'archived'].includes(project.status)) throw bad(`Project is ${project.status}`);
  return project;
}

tasks.get('/import/template', requireRole('owner'), async (req, res) => {
  const project = await importProject(req.query.project);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(await buildTemplate(project));
});

// Step 1: read the uploaded sheet and validate every row. Nothing is created.
tasks.post('/import/preview', requireRole('owner'), async (req, res) => {
  const project = await importProject(req.formData?.get('project'));
  const file = req.formData?.get('file');
  if (!file || typeof file === 'string') throw bad('No file provided');
  if (file.size > XLSX_MAX_BYTES) throw bad('File is too large (5 MB limit)');
  const { rows, ignoredColumns } = await parseSheet(Buffer.from(await file.arrayBuffer()));
  const resolved = await resolveRows(project, rows, { defaultListId: req.formData.get('defaultList') || undefined, forceListId: req.formData.get('forceList') || undefined, defaultStatus: req.formData.get('defaultStatus') || undefined });
  res.json({ ignoredColumns, rows: resolved.map(({ n, raw, errors, warnings, duplicate, view }) => ({ n, raw, errors, warnings, duplicate, view })) });
});

// Step 2: create one chunk of rows. Rows are re-validated here; one bad row never blocks the others.
tasks.post('/import/commit', requireRole('owner'), async (req, res) => {
  const { project: projectId, rows, defaultList, forceList, defaultStatus, skipDuplicates = true } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows to import');
  if (rows.length > IMPORT_CHUNK_MAX) throw bad(`Send at most ${IMPORT_CHUNK_MAX} rows at a time`);
  const project = await importProject(projectId);
  const resolved = await resolveRows(project, rows, { defaultListId: defaultList, forceListId: forceList, defaultStatus });
  const results = [];
  const assigned = {};
  for (const r of resolved) { // sequential on purpose: keeps card order and stays inside Trello's rate limit
    if (r.errors.length) { results.push({ n: r.n, status: 'error', error: r.errors.join('; ') }); continue; }
    if (r.duplicate && skipDuplicates) { results.push({ n: r.n, status: 'skipped', error: 'Already exists in this list' }); continue; }
    try {
      const task = await createTask({ actor: req.user, project, parent: null, data: r.data, notifyAssignee: false });
      for (const sub of r.data.subtasks)
        await createTask({ actor: req.user, project, parent: task, data: { title: sub.title, estimateSeconds: sub.estimateSeconds, assignee: task.assignee, priority: task.priority, deadline: task.deadline }, notifyAssignee: false });
      if (task.assignee) assigned[String(task.assignee)] = (assigned[String(task.assignee)] || 0) + 1;
      results.push({ n: r.n, status: 'created', id: String(task._id) });
    } catch (e) {
      console.error('import row failed', e);
      results.push({ n: r.n, status: 'error', error: e.name === 'ValidationError' ? Object.values(e.errors)[0].message : 'Could not create this task' });
    }
  }
  res.json({ results, assigned });
});

// Step 3: one audit entry and one notification per person for the whole import.
tasks.post('/import/finish', requireRole('owner'), async (req, res) => {
  const { project: projectId, created = 0, skipped = 0, failed = 0, assigned = {} } = req.body || {};
  const project = await Project.findById(projectId);
  if (!project) throw notFound('Project not found');
  await audit(req.user, 'task.import', 'Project', project, `Imported ${created} task${created === 1 ? '' : 's'} from Excel into "${project.name}" (${skipped} skipped, ${failed} failed)`, { project: project._id, created, skipped, failed });
  for (const [uid, n] of Object.entries(assigned)) {
    if (uid === String(req.user._id) || !/^[a-f0-9]{24}$/.test(uid)) continue;
    const count = Math.max(0, Math.min(Number(n) || 0, 1000));
    if (count) await notify(uid, `${req.user.name} assigned you ${count} new task${count === 1 ? '' : 's'} in "${project.name}"`, `/projects/${project._id}`);
  }
  res.json({ ok: true });
});

tasks.get('/:id', async (req, res) => {
  const { task, project } = await loadTask(req);
  // Reaching this point already means taskVisible() granted access — as a manager/owner, the task's own assignee/collaborator,
  // or a sibling subtask's assignee/collaborator. Anyone in that set is part of this ticket's team, so they see every
  // subtask here (teammates' progress), not just their own.
  const subFilter = { parent: task._id };
  // Same reasoning as the subtasks list above: anyone who can view this ticket sees everyone's tracked time on it
  // and its subtasks too, not just their own — so teammates can see each other's logged time, not just the running badge.
  const [subs, entries, comments, activity, projectDoc, hasEstimatedKids] = await Promise.all([
    Task.find(subFilter).populate(POP).sort({ order: 1, createdAt: 1 }),
    Task.find({ parent: task._id }).distinct('_id').then((subIds) => TimeEntry.find({ $or: [{ task: task._id }, { task: { $in: subIds } }] })
      .populate('user', USER_FIELDS).populate('task', 'title parent').sort({ createdAt: -1 }).limit(100)),
    Comment.find({ task: task._id }).populate('user', USER_FIELDS).sort({ createdAt: 1 }),
    AuditEvent.find({ entityType: 'Task', entityId: String(task._id) }).populate('actor', USER_FIELDS).sort({ createdAt: -1 }).limit(30),
    Project.findById(project._id).populate('members', 'name color title role'), // what the task panel needs: team, Trello lists/labels, Chronos-only lists
    task.parent ? null : hasEstimatedSubtasks(task._id),
  ]);
  const estimateDerived = !task.parent && !!hasEstimatedKids;
  const parentOwner = await ownsParentOf(req.user, task);
  const creatorOfTask = !task.parent && sameId(task.createdBy, req.user); // whoever created a task keeps full say over it, even after giving it to someone else
  const isAssignedToMe = req.user.role !== 'viewer' && (sameId(task.assignee, req.user) || task.collaborators.some((c) => sameId(c, req.user)) || parentOwner || creatorOfTask);
  // The card's own Trello history (joined / left, moves, due date, files, labels) sits in the same Activity list, newest first.
  const trelloEvents = task.parent ? [] : await TrelloActivity.find({ task: task._id }).sort({ at: -1 }).limit(60).lean();
  const activityAll = [
    ...activity.map((a) => a.toJSON()),
    ...trelloEvents.map((e) => ({ id: `tr-${e._id}`, summary: e.summary, actor: { name: e.actorName }, createdAt: e.at, source: 'trello' })),
  ].sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt)).slice(0, 80);
  const [self, ...rest] = await addWaiting(req.user, await attachTotals([task, ...subs]));
  res.json({ task: self, project: projectDoc, subtasks: rest, entries, comments, activity: activityAll, canManage: canCoordinate(req.user, project) || isAssignedToMe, canAssign: canCoordinate(req.user, project), canReassign: canCoordinate(req.user, project) || isAssignedToMe, estimateDerived, canEstimate: !!(task.parent && (canCoordinate(req.user, project) || ((sameId(task.assignee, req.user) || parentOwner) && req.user.role !== 'viewer')) && (task.status !== 'completed' || isOwner(req.user))), canEditRequirements: !!(canCoordinate(req.user, project) || ownTask(req.user, task) || ((sameId(task.assignee, req.user) || task.collaborators.some((c) => sameId(c, req.user)) || parentOwner || creatorOfTask) && req.user.role !== 'viewer')), canSyncTracked: !!canCoordinate(req.user, project) });
});

tasks.patch('/:id', async (req, res) => {
  const { task, project } = await loadTask(req);
  const b = req.body || {};
  const coordinator = canCoordinate(req.user, project);
  const parentOwner = await ownsParentOf(req.user, task); // owner of the parent task: manages its subtasks too
  const creatorOfTask = !task.parent && sameId(task.createdBy, req.user);
  const participant = sameId(task.assignee, req.user) || task.collaborators.some((c) => sameId(c, req.user)) || parentOwner || creatorOfTask;
  // The task owner (the person assigned; for a parent task every assigned person) can edit everything on their task. Tracked time stays
  // with the owner / project manager.
  const fullEdit = coordinator || participant;
  if (!coordinator && !participant) throw forbidden();
  if (req.user.role === 'viewer') throw forbidden('Viewers have read-only access');

  // The person a task is assigned to may also change its ESTIMATE (e.g. when more time is needed for new subtasks).
  const isAssignee = sameId(task.assignee, req.user);
  const taskOwnerKeys = ['status', 'overrideReason', 'stageId', 'description', 'criteria', ...(task.parent && (isAssignee || parentOwner) ? ['estimateSeconds', 'syncTracked'] : [])];
  const touching = Object.keys(b).filter((k) => !taskOwnerKeys.includes(k));
  if (!fullEdit && touching.length) throw forbidden('Only the person assigned, the owner or the project manager can edit this.');

  const log = [];
  const teamBefore = [task.assignee, ...(task.collaborators || [])].filter(Boolean).map((u) => String(u._id || u)); // who was on the ticket before this edit
  const push = {}; // which fields must also be sent to Trello
  if (b.status !== undefined && b.status !== task.status) {
    if (!TASK_STATUSES.includes(b.status)) throw bad('Invalid status');
    if (b.status === 'completed' && !task.parent) {
      const open = await Task.countDocuments({ parent: task._id, required: true, status: { $nin: ['completed', 'cancelled'] } });
      if (open) {
        const mayOverride = isProjectManager(req.user, project);
        if (!(mayOverride && b.overrideReason?.trim()))
          throw new HttpError(409, `${open} required subtask${open > 1 ? 's are' : ' is'} still incomplete`, mayOverride ? 'SUBTASKS_INCOMPLETE_OVERRIDABLE' : 'SUBTASKS_INCOMPLETE');
        log.push(`override: ${b.overrideReason.trim()}`);
      }
    }
    log.push(`status ${task.status} → ${b.status}`);
    task.completedAt = b.status === 'completed' ? new Date() : null; // reopening keeps all history
    task.status = b.status;
    push.status = true;
  }
  if (fullEdit || participant) {
    for (const k of ['description', 'criteria']) if (b[k] !== undefined) { if (k === 'description' && b[k] !== task.description) push.description = true; task[k] = b[k]; } // a Trello ticket's description goes to its card
  }
  if (fullEdit) {
    if (b.title !== undefined) { if (!b.title.trim()) throw bad('Title is required'); if (b.title.trim() !== task.title) push.title = true; task.title = b.title.trim(); }
    if (b.priority !== undefined) {
      if (!PRIORITIES.includes(b.priority)) throw bad('Invalid priority');
      if (b.priority !== task.priority) log.push(`priority → ${b.priority}`);
      task.priority = b.priority;
    }
    if (b.deadline !== undefined) {
      if (b.deadline && String(b.deadline).slice(0, 10) < todayStr()) throw bad('Deadline cannot be in the past');
      task.deadline = b.deadline || null; push.deadline = true; log.push('deadline changed');
    }
    if (b.required !== undefined) task.required = !!b.required;
    if (b.collaborators !== undefined) {
      if (task.parent) {
        if (b.collaborators.length) throw bad('A subtask has exactly one assignee. Assign several people on the parent task instead.');
        task.collaborators = [];
      } else {
        for (const c of b.collaborators) await assertAssignable(project, c);
        const before = (task.collaborators || []).map((c) => String(c._id || c));
        for (const c of b.collaborators) if (!before.includes(String(c)) && !sameId(c, req.user)) await notify(c, `${req.user.name} added you to "${task.title}"`, `/projects/${project._id}?task=${task._id}`);
        task.collaborators = b.collaborators;
      }
      push.assignee = true;
    }
    if (b.assignee !== undefined && String(b.assignee || '') !== String(task.assignee?._id || '')) {
      await assertAssignable(project, b.assignee);
      log.push('reassigned');
      // Anyone else's open timer on this task is saved as a time entry (nothing is lost) and closed.
      const open = await TimerSession.find({ task: task._id, ...(b.assignee ? { user: { $ne: b.assignee } } : {}) });
      const now = new Date();
      for (const s of open) {
        const secs = Math.round(s.accumulatedSeconds + (s.state === 'running' ? Math.max(0, (now - s.segmentStart) / 1000) : 0));
        if (secs >= 1)
          await TimeEntry.create({
            user: s.user, project: s.project, task: s.task, workDate: workDateOf(s.firstStartedAt), startedAt: s.firstStartedAt, endedAt: now,
            durationSeconds: secs, description: s.description || '', source: 'timer', clientId: `timer-${s._id}`,
            history: [{ at: now, by: req.user._id, change: 'Timer closed because the task was reassigned' }],
          });
        await s.deleteOne();
      }
      task.assignee = b.assignee || null;
      if (b.assignee && task.restricted) { task.restricted = false; await Task.updateMany({ parent: task._id }, { $set: { restricted: false } }); } // the admin gave it to an approved person
      push.assignee = true;
      if (b.assignee && !sameId(b.assignee, req.user))
        await notify(b.assignee, `${req.user.name} assigned you "${task.title}"`, `/projects/${project._id}?task=${task._id}`);
    }
  }
  if (!task.parent && (b.assignee !== undefined || b.collaborators !== undefined)) {
    // Say exactly who joined and who left. Nothing else changes: tracked time, comments and subtasks stay as they are.
    const teamAfter = [task.assignee, ...(task.collaborators || [])].filter(Boolean).map((u) => String(u._id || u));
    const left = teamBefore.filter((id) => !teamAfter.includes(id));
    const joined = teamAfter.filter((id) => !teamBefore.includes(id));
    if (left.length || joined.length) {
      const names = new Map((await User.find({ _id: { $in: [...left, ...joined] } }).select('name').lean()).map((u) => [String(u._id), u.name]));
      if (joined.length) log.push(`added ${joined.map((id) => names.get(id) || 'someone').join(', ')}`);
      if (left.length) log.push(`removed ${left.map((id) => names.get(id) || 'someone').join(', ')} (their time and comments stay)`);
    }
  }
  if (fullEdit && b.labelIds !== undefined && isLinked(project) && !task.parent) {
    task.labels = pickLabels(project, b.labelIds);
    push.labels = true;
    log.push('labels changed');
  }
  if (b.stageId !== undefined && !task.parent && !project.trello?.boardId) {
    if (!b.stageId) {
      // back to the normal status columns
      if (task.localStage) { log.push(`list ${task.stage || '-'} → status columns`); task.localStage = null; task.stage = ''; }
    } else {
      const custom = (project.localLists || []).find((l) => l.id === b.stageId);
      if (!custom) throw bad('That list does not exist on this board');
      if (task.localStage !== custom.id) { log.push(`list ${task.stage || '-'} → ${custom.name}`); task.localStage = custom.id; task.stage = custom.name; }
    }
  }
  if (b.stageId !== undefined && !task.parent && project.trello?.boardId) {
    const local = (project.localLists || []).find((l) => l.id === b.stageId);
    const tl = (project.trello.lists || []).find((l) => l.id === b.stageId);
    const target = local || tl;
    if (!target) throw bad('That list does not exist on this board');
    const hasCard = task.trello?.kind === 'card';
    if (task.chronosOnly || !hasCard) {
      // A Chronos-only task just changes column here. Nothing is ever sent to Trello (use "Add to Trello" for that).
      if (task.localStage !== target.id) {
        log.push(`stage ${task.stage || '-'} → ${target.name} (Chronos only)`);
        task.localStage = target.id;
        task.stage = target.name;
      }
      task.chronosOnly = true;
    } else if (local) {
      // Card-backed task parked in a Chronos-only list: the Trello card stays exactly where it is
      if (task.localStage !== local.id) {
        log.push(`stage ${task.stage || '-'} → ${local.name} (Chronos only)`);
        task.localStage = local.id;
        task.stage = local.name;
      }
    } else if (isLinked(project)) {
      if (task.localStage || tl.id !== task.trello.idList) {
        log.push(`stage ${task.stage || '-'} → ${tl.name}`);
        task.stage = tl.name;
        task.localStage = null;
        if (tl.id !== task.trello.idList) { task.trello.idList = tl.id; task.markModified('trello'); push.stage = true; }
      }
    }
  }
  let syncTracked = null;
  if (b.estimateSeconds !== undefined) {
    const n = b.estimateSeconds === '' || b.estimateSeconds === null ? null : Number(b.estimateSeconds);
    if (n !== null && !(n >= 0)) throw bad('Estimate must be 0 or more');
    if (n !== task.estimateSeconds) {
      // Hours are set on SUBTASKS, by the owner / project manager. A task's hours are always the total of its subtasks.
      if (!coordinator && !(task.parent && (isAssignee || parentOwner))) throw forbidden('Only the owner of this subtask or of its parent task, the owner or the project manager can change hours.');
      if (!task.parent) throw bad("A task's hours are the total of its subtasks. Set the hours on its subtasks instead.");
      if (task.status === 'completed' && !isOwner(req.user)) throw forbidden('Only the owner can change the hours of completed work.');
      log.push(`estimate ${task.estimateSeconds == null ? 'none' : hrs(task.estimateSeconds)} → ${n == null ? 'none' : hrs(n)}`);
      task.estimateSeconds = n;
      if (b.syncTracked && n != null && coordinator) syncTracked = await planTrackedSync(task, n, req.user); // validated now, applied after the save
    }
  }
  await task.save();
  if (syncTracked) {
    const line = await syncTracked();
    log.push(line);
    await audit(req.user, 'time.correct', 'Task', task, `${task.title}: ${line} (set to match the new estimate)`, { project: project._id });
  }
  if (Object.keys(push).length) await pushTask(task, project, push); // keep Trello in step (failures are recorded, never block the edit)
  if (task.parent) {
    await syncParentEstimate(task.parent, req.user, project._id); // subtask re-estimated / cancelled / reopened
    await syncParentCompletion(task.parent, req.user, project); // auto-complete/reopen the parent based on its subtasks
  }
  if (log.length) await audit(req.user, 'task.update', 'Task', task, `${task.title}: ${log.join('; ')}`, { project: project._id });
  const fresh = await Task.findById(task._id).populate(POP);
  res.json((await attachTotals([fresh]))[0]);
});

// Send a Chronos-only task to Trello on purpose: creates the card only (its subtasks stay internal). Never happens by moving it around.
tasks.post('/:id/add-to-trello', async (req, res) => {
  const { task, project } = await loadTask(req, false);
  if (!canCoordinate(req.user, project)) throw forbidden('Only a manager or the owner can add a task to Trello');
  if (task.parent) throw bad('Subtasks go to Trello as checklist items of their task. Add the task itself.');
  if (!isLinked(project)) throw bad('This project is not linked to Trello, or Trello is not configured on the server');
  if (task.trello?.kind === 'card') throw bad('This task is already in Trello');
  const list = (project.trello.lists || []).find((l) => l.id === (req.body?.stageId || task.localStage));
  if (!list) throw bad('Move the task into one of the Trello lists first, then add it to Trello');
  await createCardFor(task, project, list.id);
  const card = await Task.findById(task._id).select('trello');
  if (card?.trello?.kind !== 'card') throw new HttpError(502, 'Trello did not accept the card. Check the Trello connection and try again.');
  await Task.updateOne({ _id: task._id }, { $set: { chronosOnly: false, localStage: null } });
  await audit(req.user, 'task.update', 'Task', task, `${task.title}: added to Trello (list "${list.name}")`, { project: project._id });
  const fresh = await Task.findById(task._id).populate(POP);
  res.json((await attachTotals([fresh]))[0]);
});

tasks.delete('/:id', async (req, res) => {
  const { task, project } = await loadTask(req, false);
  const assignedToMe = req.user.role !== 'viewer' && (sameId(task.assignee, req.user) || (task.collaborators || []).some((c) => sameId(c, req.user)) || (await ownsParentOf(req.user, task)));
  if (!canCoordinate(req.user, project) && !assignedToMe) throw forbidden();
  const ids = [task._id, ...(await Task.find({ parent: task._id }).distinct('_id'))];
  if (await TimeEntry.exists({ task: { $in: ids } }))
    throw new HttpError(409, 'This work has tracked time. Mark it Cancelled instead of deleting, so history is preserved.', 'HAS_TIME');
  await TimerSession.deleteMany({ task: { $in: ids } });
  await Comment.deleteMany({ task: { $in: ids } });
  await Task.deleteMany({ _id: { $in: ids } });
  if (task.trello?.kind === 'card') await archiveCardFor(task, project); // the Trello card is archived, not destroyed
  if (task.parent) {
    await syncParentEstimate(task.parent, req.user, project._id);
    await syncParentCompletion(task.parent, req.user, project);
  }
  await audit(req.user, 'task.delete', 'Task', task, `Deleted "${task.title}"`, { project: project._id });
  res.json({ ok: true });
});

// A comment on a MAIN task that has a Trello card is also posted on that card (prefixed with the author's name, since the Trello
// account is shared). Comments on subtasks and on Chronos-only tasks stay internal. Comments written in Trello are pulled in by sync.
tasks.post('/:id/comments', async (req, res) => {
  const { task, project } = await loadTask(req, false);
  if (req.user.role === 'viewer') throw forbidden('Viewers have read-only access');
  const body = String(req.body?.body || '').trim();
  if (!body) throw bad('Comment cannot be empty');
  const c = await Comment.create({ task: task._id, user: req.user._id, body });
  let trelloSyncFailed = false;
  if (!task.parent && !task.chronosOnly && task.trello?.kind === 'card' && task.trello.cardId && isLinked(project)) {
    try {
      const posted = await tAddComment(task.trello.cardId, `${req.user.name}: ${body}`);
      if (posted?.id) { c.trelloCommentId = posted.id; await c.save(); } // remembered, so the next sync does not pull our own comment back in as a duplicate
    } catch { trelloSyncFailed = true; }
  }
  if (task.assignee && !sameId(task.assignee, req.user))
    await notify(task.assignee, `${req.user.name} commented on "${task.title}"`, `/projects/${task.project}?task=${task._id}`);
  res.status(201).json({ ...(await c.populate('user', USER_FIELDS)).toJSON(), trelloSyncFailed });
});

// Edit or delete your own comment. If it was also posted on the Trello card, the card's comment follows (same as editing it in Trello).
async function ownComment(req) {
  const { task, project } = await loadTask(req, false);
  const c = await Comment.findOne({ _id: req.params.cid, task: task._id });
  if (!c) throw notFound('Comment not found');
  if (c.source === 'trello') throw forbidden('This comment was written in Trello. Edit it there.');
  if (!sameId(c.user, req.user) && !isOwner(req.user)) throw forbidden('You can only change your own comments');
  return { task, project, c };
}
const onCard = (task, project, c) => !task.parent && !task.chronosOnly && task.trello?.cardId && c.trelloCommentId && isLinked(project);

tasks.patch('/:id/comments/:cid', async (req, res) => {
  const { task, project, c } = await ownComment(req);
  const body = String(req.body?.body || '').trim();
  if (!body) throw bad('Comment cannot be empty');
  let trelloSyncFailed = false;
  if (onCard(task, project, c)) {
    try { await tPut(`/cards/${task.trello.cardId}/actions/${c.trelloCommentId}/comments`, { text: `${req.user.name}: ${body}` }); } catch { trelloSyncFailed = true; }
  }
  c.body = body;
  c.editedAt = new Date();
  await c.save();
  res.json({ ...(await c.populate('user', USER_FIELDS)).toJSON(), trelloSyncFailed });
});

tasks.delete('/:id/comments/:cid', async (req, res) => {
  const { task, project, c } = await ownComment(req);
  let trelloSyncFailed = false;
  if (onCard(task, project, c)) {
    try { await tDel(`/cards/${task.trello.cardId}/actions/${c.trelloCommentId}/comments`); } catch { trelloSyncFailed = true; }
  }
  await c.deleteOne();
  res.json({ ok: true, trelloSyncFailed });
});

// Uploads a file straight to the task's Trello card as an attachment (multipart/form-data, field "file").
// Returns the attachment info only — the caller composes it into a comment (so an image + caption become one comment).
tasks.post('/:id/attachment', async (req, res) => {
  const { task, project } = await loadTask(req, false);
  if (req.user.role === 'viewer') throw forbidden('Viewers have read-only access');
  if (!isLinked(project) || !task.trello?.cardId) throw bad('This task is not linked to a Trello card, so files cannot be attached.');
  const file = req.formData?.get('file');
  if (!file || typeof file === 'string') throw bad('No file provided');
  if (file.size > 10 * 1024 * 1024) throw bad('File is too large (10 MB limit)');
  const attachment = await tUploadAttachment(task.trello.cardId, file);
  await audit(req.user, 'task.attachment', 'Task', task, `${req.user.name} attached "${file.name}" (synced to Trello)`, { project: project._id });
  res.status(201).json({ attachment });
});
