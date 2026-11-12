import { Router } from '../router.js';
import crypto from 'node:crypto';
import { tPost, trelloConfigured } from '../trello.js';
import { Project, Task, User, TimeEntry, PROJECT_STATUSES, TASK_STATUSES } from '../models/index.js';
import {
  authenticate, requireRole, bad, notFound, forbidden, audit, notify,
  isOwner, isProjectManager, canCoordinate, canViewProject, seesAllTasks, visibleProjectFilter, projectTotals, computeTotals, secondsByTask,
} from '../util.js';

export const projects = Router();
projects.use(authenticate);

const POP = [
  { path: 'manager', select: 'name color title' },
  { path: 'lead', select: 'name color title' },
  { path: 'members', select: 'name email color title role active pending createdAt' },
];

async function present(docs) {
  const totals = await projectTotals(docs.map((d) => d._id));
  return docs.map((d) => ({ ...d.toJSON(), stats: totals.get(String(d._id)) }));
}

async function loadProject(req) {
  const p = await Project.findById(req.params.id).populate(POP);
  if (!p) throw notFound('Project not found');
  if (!canViewProject(req.user, p)) throw notFound('Project not found'); // do not reveal existence
  return p;
}

projects.get('/', async (req, res) => {
  const { status, manager, q } = req.query;
  const filter = { ...visibleProjectFilter(req.user) };
  if (status) filter.status = status;
  if (manager) filter.manager = manager;
  if (q) filter.name = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const docs = await Project.find(filter).populate(POP).sort({ createdAt: -1 });
  res.json(await present(docs));
});

projects.post('/', requireRole('owner', 'manager'), async (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) throw bad('Project name is required');
  // Managers can only create projects they manage; the owner can assign any manager.
  const managerId = isOwner(req.user) && b.manager ? b.manager : req.user._id;
  const mgr = await User.findById(managerId);
  if (!mgr || !['owner', 'manager'].includes(mgr.role)) throw bad('Selected manager must have the Manager or Owner role');
  if (b.status && !PROJECT_STATUSES.includes(b.status)) throw bad('Invalid status');
  const members = [...new Set([String(mgr._id), ...(b.members || [])])];
  const p = await Project.create({
    name: b.name.trim(), description: b.description || '', manager: mgr._id, members,
    status: b.status || 'planning', startDate: b.startDate || null, targetDate: b.targetDate || null,
    color: b.color || '#6366f1',
  });
  await audit(req.user, 'project.create', 'Project', p, `Created project "${p.name}"`, { project: p._id });
  for (const m of members) if (String(m) !== String(req.user._id)) await notify(m, `You were added to project "${p.name}"`, `/projects/${p._id}`);
  res.status(201).json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});

projects.get('/:id', async (req, res) => {
  const p = await loadProject(req);
  const [[out], entries, open] = await Promise.all([
    present([p]),
    TimeEntry.aggregate([
      { $match: { project: p._id } },
      { $group: { _id: '$user', s: { $sum: '$durationSeconds' } } },
    ]),
    // per-member workload: open tasks assigned in this project
    Task.aggregate([
      { $match: { project: p._id, status: { $nin: ['completed', 'cancelled'] }, assignee: { $ne: null } } },
      { $group: { _id: '$assignee', n: { $sum: 1 } } },
    ]),
  ]);
  out.timeByUser = Object.fromEntries(entries.map((e) => [String(e._id), e.s]));
  out.openByUser = Object.fromEntries(open.map((e) => [String(e._id), e.n]));
  if (!seesAllTasks(req.user, p)) {
    // team members see who is on the team, but not each other's hours or workload
    const me = String(req.user._id);
    out.timeByUser = { [me]: out.timeByUser[me] || 0 };
    out.openByUser = { [me]: out.openByUser[me] || 0 };
  }
  res.json(out);
});

projects.patch('/:id', async (req, res) => {
  const p = await loadProject(req);
  if (!isProjectManager(req.user, p)) throw forbidden();
  const b = req.body || {};
  const changes = [];
  for (const k of ['name', 'description', 'color']) if (b[k] !== undefined && b[k] !== p[k]) { p[k] = b[k]; changes.push(k); }
  if (b.status !== undefined) {
    if (!PROJECT_STATUSES.includes(b.status)) throw bad('Invalid status');
    if (b.status !== p.status) changes.push(`status ${p.status} → ${b.status}`);
    p.status = b.status;
  }
  for (const k of ['startDate', 'targetDate']) if (b[k] !== undefined) { p[k] = b[k] || null; changes.push(k); }
  if (b.manager !== undefined && String(b.manager) !== String(p.manager._id)) {
    if (!isOwner(req.user)) throw forbidden('Only the owner can reassign the project manager');
    const mgr = await User.findById(b.manager);
    if (!mgr || !['owner', 'manager'].includes(mgr.role)) throw bad('Selected manager must have the Manager or Owner role');
    p.manager = mgr._id;
    if (!p.members.some((m) => String(m._id) === String(mgr._id))) p.members.push(mgr._id);
    changes.push('manager');
  }
  await p.save();
  await audit(req.user, 'project.update', 'Project', p, `Updated "${p.name}": ${changes.join(', ') || 'no changes'}`, { project: p._id });
  res.json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});

// ---- Labels: created here, they are created on the Trello board too (so both sides always show the same labels)
const LABEL_COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black'];
projects.post('/:id/labels', async (req, res) => {
  const p = await loadProject(req);
  if (!isOwner(req.user)) throw forbidden('Only the owner can create labels');
  if (!p.trello?.boardId) throw bad('Labels are shared with Trello, so this project must be linked to a Trello board');
  if (!trelloConfigured()) throw bad('Trello is not configured on the server, so the label cannot be created in Trello');
  const name = String(req.body?.name || '').trim();
  const color = String(req.body?.color || '');
  if (!name) throw bad('Label name is required');
  if (name.length > 40) throw bad('Label name is too long (40 characters max)');
  if (!LABEL_COLORS.includes(color)) throw bad(`Colour must be one of: ${LABEL_COLORS.join(', ')}`);
  if ((p.trello.labels || []).some((l) => norm(l.name) === norm(name))) throw bad('A label with this name already exists on the board');
  const made = await tPost('/labels', { name, color, idBoard: p.trello.boardId }); // created in Trello first: if that fails nothing changes here
  const label = { id: made.id, name: made.name || name, color: made.color || color };
  await Project.updateOne({ _id: p._id }, { $push: { 'trello.labels': label } });
  await audit(req.user, 'project.update', 'Project', p, `Created label "${name}" (${color}) in Chronos and Trello`, { project: p._id });
  res.status(201).json({ label });
});

// ---- Custom board lists. The owner, the project manager and every team member of the project (not read-only viewers) can add, rename and
// delete them. A list that still has cards cannot be deleted. They never reach Trello.
const norm = (x) => String(x || '').trim().toLowerCase();
function listName(p, raw, exceptId) {
  const name = String(raw || '').trim();
  if (!name) throw bad('List name is required');
  if (name.length > 40) throw bad('List name is too long (40 characters max)');
  const taken = [...(p.trello?.lists || []), ...(p.localLists || []).filter((l) => l.id !== exceptId)].some((l) => norm(l.name) === norm(name));
  if (taken) throw bad('A list with this name already exists on the board');
  return name;
}
/** Any member of the project (not a read-only viewer) may work with custom lists. */
async function listProject(req) {
  const p = await loadProject(req); // 404 for anyone who is not on the project
  if (req.user.role === 'viewer') throw forbidden('Viewers have read-only access');
  if (['completed', 'archived'].includes(p.status)) throw bad(`Project is ${p.status}`);
  return p;
}
/** A REAL Trello list changes the shared Trello board, so it stays with the owner / project manager. */
async function trelloListProject(req) {
  const p = await loadProject(req);
  if (!isProjectManager(req.user, p)) throw forbidden('Only the owner or the project manager can add a list to the Trello board');
  if (!p.trello?.boardId) throw bad('This project is not linked to a Trello board');
  return p;
}

// A normal list: created on the Trello board AND in Chronos (same as a list made in Trello and then synced).
projects.post('/:id/lists', async (req, res) => {
  const p = await trelloListProject(req);
  if (!trelloConfigured()) throw bad('Trello is not configured on the server, so the list cannot be created in Trello');
  const name = listName(p, req.body?.name);
  const made = await tPost('/lists', { name, idBoard: p.trello.boardId, pos: 'bottom' }); // Trello first: if it fails nothing changes here
  await Project.updateOne({ _id: p._id }, { $push: { 'trello.lists': { id: made.id, name: made.name || name } } });
  await audit(req.user, 'project.update', 'Project', p, `Added list "${name}" in Chronos and Trello`, { project: p._id });
  res.status(201).json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});

projects.post('/:id/local-lists', async (req, res) => {
  const p = await listProject(req);
  const name = listName(p, req.body?.name);
  p.localLists.push({ id: `loc_${crypto.randomBytes(6).toString('hex')}`, name, createdBy: String(req.user._id) });
  await p.save();
  await audit(req.user, 'project.update', 'Project', p, `Added Chronos-only list "${name}"`, { project: p._id });
  res.status(201).json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});

projects.patch('/:id/local-lists/:listId', async (req, res) => {
  const p = await listProject(req);
  const l = p.localLists.find((x) => x.id === req.params.listId);
  if (!l) throw notFound('List not found');
  const name = listName(p, req.body?.name, l.id);
  const old = l.name;
  l.name = name;
  await p.save();
  await Task.updateMany({ project: p._id, localStage: l.id }, { $set: { stage: name } });
  await audit(req.user, 'project.update', 'Project', p, `Renamed Chronos-only list "${old}" → "${name}"`, { project: p._id });
  res.json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});

projects.delete('/:id/local-lists/:listId', async (req, res) => {
  const p = await listProject(req);
  const l = p.localLists.find((x) => x.id === req.params.listId);
  if (!l) throw notFound('List not found');
  const n = await Task.countDocuments({ project: p._id, localStage: l.id, parent: null });
  if (n) throw bad(`"${l.name}" still has ${n} task${n === 1 ? '' : 's'}. Move them to another list first.`);
  p.localLists = p.localLists.filter((x) => x.id !== l.id);
  await p.save();
  await audit(req.user, 'project.update', 'Project', p, `Deleted Chronos-only list "${l.name}"`, { project: p._id });
  res.json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});

// ---- Status columns (projects WITHOUT Trello): any team member of the project can give a column its own name, hide one that is empty, or bring it back.
const STATUS_DEFAULT = { todo: 'To Do', in_progress: 'In Progress', blocked: 'Blocked', in_review: 'In Review', completed: 'Completed', cancelled: 'Cancelled' };
projects.patch('/:id/status-columns/:status', async (req, res) => {
  const p = await listProject(req);
  if (p.trello?.boardId) throw bad("The columns of a Trello project are its Trello lists");
  const status = req.params.status;
  if (!TASK_STATUSES.includes(status)) throw notFound('Unknown column');
  const b = req.body || {};
  const labels = { ...(p.statusLabels || {}) };
  const update = {};
  const what = [];
  if (b.name !== undefined) {
    const name = String(b.name || '').trim();
    if (!name) { update.$unset = { [`statusLabels.${status}`]: '' }; delete labels[status]; what.push('name reset'); }
    else {
      if (name.length > 40) throw bad('Name is too long (40 characters max)');
      const clash = [...Object.keys(STATUS_DEFAULT).filter((s) => s !== status).map((s) => labels[s] || STATUS_DEFAULT[s]), ...(p.localLists || []).map((l) => l.name)].some((x) => norm(x) === norm(name));
      if (clash) throw bad('A column with this name already exists on the board');
      update.$set = { ...(update.$set || {}), [`statusLabels.${status}`]: name };
      what.push(`renamed to "${name}"`);
    }
  }
  if (b.hidden !== undefined) {
    if (b.hidden) {
      const n = await Task.countDocuments({ project: p._id, parent: null, status, localStage: null });
      if (n) throw bad(`"${labels[status] || STATUS_DEFAULT[status]}" still has ${n} card${n === 1 ? '' : 's'}. Move them to another column first.`);
      update.$addToSet = { hiddenStatuses: status };
      what.push('hidden');
    } else { update.$pull = { hiddenStatuses: status }; what.push('shown again'); }
  }
  if (!Object.keys(update).length) return res.json((await present([p]))[0]);
  await Project.updateOne({ _id: p._id }, update);
  await audit(req.user, 'project.update', 'Project', p, `Board column ${STATUS_DEFAULT[status]}: ${what.join(', ')}`, { project: p._id });
  res.json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});
projects.post('/:id/status-columns/restore', async (req, res) => {
  const p = await listProject(req);
  await Project.updateOne({ _id: p._id }, { $set: { hiddenStatuses: [] } });
  res.json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});

// Replace the project team. Removing someone never deletes their tasks, time or comments.
projects.put('/:id/members', async (req, res) => {
  const p = await loadProject(req);
  if (!isProjectManager(req.user, p)) throw forbidden();
  const ids = [...new Set((req.body?.members || []).map(String))];
  const found = await User.find({ _id: { $in: ids }, active: true });
  const set = new Set(found.map((u) => String(u._id)));
  set.add(String(p.manager._id)); // the manager is always on the team
  const before = new Set(p.members.map((m) => String(m._id)));
  p.members = [...set];
  const lead = req.body?.lead === undefined ? p.lead?._id : req.body.lead;
  p.lead = lead && set.has(String(lead)) ? lead : null;
  await p.save();
  const added = [...set].filter((i) => !before.has(i));
  const removed = [...before].filter((i) => !set.has(i));
  await audit(req.user, 'project.team', 'Project', p, `Team of "${p.name}" updated (+${added.length} / -${removed.length})`, { project: p._id, added, removed });
  for (const m of added) await notify(m, `You were added to project "${p.name}"`, `/projects/${p._id}`);
  res.json((await present([await Project.findById(p._id).populate(POP)]))[0]);
});
