// Two-way sync between a Trello board and a Chronos project.
//  Trello -> Chronos : pullBoard()      (import, "Sync now", periodic refresh)
//  Chronos -> Trello : pushTask(), createCardFor(), archiveCardFor()
// Mapping: board = project, list = stage, card = task, label = label (subtasks are Chronos-only and never synced),
//          due date = deadline, "due complete"/archived = completed/cancelled, card member = assignee.
// Loop protection: after every push we store the card's new dateLastActivity, so the next pull does not treat our own change as a Trello edit.
import { Project, Task, User, Comment, TrelloActivity } from './models/index.js';
import { tGet, tPut, tPost, parseBoardRef, fetchAllCards, trelloConfigured, BOARD_PARAMS } from './trello.js';
import { audit, bad, notify } from './util.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export const PLACEHOLDER_DOMAIN = '@trello.invalid';
const PALETTE = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ef4444', '#22c55e'];

const norm = (s) => String(s || '').trim().toLowerCase();
export const isLinked = (project) => !!project?.trello?.boardId && trelloConfigured();

/** Trello board members -> Chronos users, matched by full name or username (Trello hides email addresses). */
async function matchMembers(members) {
  const users = await User.find({ active: true, pending: { $ne: true } }).select('name email trelloMemberId');
  const byKey = new Map();
  for (const u of users) {
    byKey.set(norm(u.name), u._id); byKey.set(norm(u.email.split('@')[0]), u._id);
    if (u.trelloMemberId) byKey.set(`id:${u.trelloMemberId}`, u._id);
  }
  // People found on Trello who have no login yet: they are real (not yet approved) people, so they can sit on cards and be picked
  // as assignees. A real account always wins over one of these.
  const waiting = new Map((await User.find({ pending: true, trelloMemberId: { $ne: null }, trelloIgnored: { $ne: true } }).select('trelloMemberId')).map((u) => [u.trelloMemberId, u._id]));
  const map = [];
  for (const m of members) {
    const userId = byKey.get(`id:${m.id}`) || byKey.get(norm(m.fullName)) || byKey.get(norm(m.username)) || waiting.get(m.id);
    if (userId) map.push({ trelloId: m.id, userId });
  }
  return map;
}

/** Board members with no Chronos account (matched or already waiting) get a PENDING account for the admin to approve. */
async function createPendingUsers(members, memberMap) {
  const matched = new Set(memberMap.map((m) => m.trelloId));
  const created = [];
  for (const m of members) {
    if (matched.has(m.id) || !m.username) continue;
    const name = (m.fullName || m.username).trim().slice(0, 80);
    const waiting = await User.exists({ pending: true, $or: [{ trelloMemberId: m.id }, { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] });
    if (waiting) continue;
    if ((await User.countDocuments({ pending: true })) >= 50) break; // same cap as self sign-up
    try {
      const count = await User.countDocuments();
      const u = await User.create({
        name, email: `${m.username.toLowerCase()}${PLACEHOLDER_DOMAIN}`, role: 'employee', active: false, pending: true,
        trelloMemberId: m.id, color: PALETTE[count % PALETTE.length],
        passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), // unusable until the admin sets a real one on approval
      });
      created.push(u);
      await audit(null, 'user.trello', 'User', u, `${u.name} was added to a Trello board; access request created`);
    } catch (e) { if (e.code !== 11000) throw e; } // duplicate email: another sync created it first
  }
  if (created.length) {
    const owners = await User.find({ role: 'owner', active: true });
    for (const o of owners) await notify(o._id, `${created.map((u) => u.name).join(', ')} joined Trello. Add their email and password in People so they can sign in`, '/people');
  }
  return created;
}

const statusFromCard = (card) => (card.closed ? 'cancelled' : card.dueComplete ? 'completed' : null);

function applyCard(task, card, ctx, isNew) {
  const prev = task.trello?.snapshot || {};
  const members = [...(card.idMembers || [])].sort();
  task.title = (card.name || '').trim() || '(untitled card)';
  task.description = card.desc || '';
  task.deadline = card.due ? new Date(card.due) : null;
  task.labels = (card.labels || []).map((l) => ({ trelloId: l.id, name: l.name || '', color: l.color || '' }));
  task.attachments = (card.attachments || []).map((a) => ({
    trelloId: a.id, name: a.name || 'attachment', url: a.url, bytes: a.bytes, mimeType: a.mimeType, date: a.date ? new Date(a.date) : null,
    previewUrl: a.previews?.length ? a.previews[a.previews.length - 1].url : null, // largest preview, else none (non-image files)
  }));
  if (!task.localStage) task.stage = ctx.lists.get(card.idList) || task.stage || ''; // parked in a Chronos-only list: keep it there
  task.order = card.pos ? Math.round(card.pos / 1000) : task.order;
  if (isNew || JSON.stringify(prev.idMembers || []) !== JSON.stringify(members)) {
    // members changed in Trello (or first import): first matched person becomes the assignee
    const matched = members.map((id) => ctx.memberToUser.get(id)).filter(Boolean);
    if (matched.length) { task.assignee = matched[0]; task.collaborators = matched.slice(1); ctx.assignees.add(String(matched[0])); matched.slice(1).forEach((u) => ctx.assignees.add(String(u))); }
    else if (isNew) task.assignee = null;
  }
  // on Trello members, but none of them has an approved Chronos account yet: only the admin may see the card
  task.restricted = members.length > 0 && !members.some((id) => ctx.memberToUser.has(id)) && !task.assignee;
  if (isNew || prev.closed !== !!card.closed || prev.dueComplete !== !!card.dueComplete) {
    const s = statusFromCard(card);
    if (s) task.status = s;
    else if (!isNew && ['cancelled', 'completed'].includes(task.status)) task.status = 'todo'; // un-archived / un-completed in Trello
    task.completedAt = task.status === 'completed' ? task.completedAt || new Date() : null;
  }
  task.trello = {
    kind: 'card', cardId: card.id, shortUrl: card.shortUrl, idShort: card.idShort, idList: card.idList,
    lastActivity: new Date(card.dateLastActivity),
    snapshot: { closed: !!card.closed, dueComplete: !!card.dueComplete, idMembers: members },
  };
}

const ACTIVITY_TYPES = 'commentCard,createCard,addMemberToCard,removeMemberFromCard,updateCard,addAttachmentToCard,deleteAttachmentFromCard,addLabelToCard,removeLabelFromCard';

/** One Trello action as a short sentence ("joined this card", "moved this card from A to B"), or null for noise we do not show. */
function describeAction(act) {
  const d = act.data || {};
  const who = act.memberCreator?.id;
  switch (act.type) {
    case 'createCard': return `created this card${d.list?.name ? ` in ${d.list.name}` : ''}`;
    case 'addMemberToCard': return !act.member || act.member.id === who ? 'joined this card' : `added ${act.member.fullName || act.member.username} to this card`;
    case 'removeMemberFromCard': return !act.member || act.member.id === who ? 'left this card' : `removed ${act.member.fullName || act.member.username} from this card`;
    case 'addAttachmentToCard': return `attached ${d.attachment?.name || 'a file'} to this card`;
    case 'deleteAttachmentFromCard': return `deleted the ${d.attachment?.name || 'a'} attachment`;
    case 'addLabelToCard': return `added the ${d.label?.name || d.label?.color || ''} label`.replace('  ', ' ');
    case 'removeLabelFromCard': return `removed the ${d.label?.name || d.label?.color || ''} label`.replace('  ', ' ');
    case 'updateCard': {
      if (d.listBefore && d.listAfter) return `moved this card from ${d.listBefore.name} to ${d.listAfter.name}`;
      const old = d.old || {};
      if ('due' in old) return d.card?.due ? `set the due date to ${String(d.card.due).slice(0, 10)}` : 'removed the due date';
      if ('closed' in old) return d.card?.closed ? 'archived this card' : 'sent this card back to the board';
      if ('dueComplete' in old) return d.card?.dueComplete ? 'marked the due date complete' : 'marked the due date incomplete';
      if ('name' in old) return `renamed this card (was "${old.name}")`;
      if ('desc' in old) return 'changed the description';
      return null; // position, cover and similar changes are not worth listing
    }
    default: return null;
  }
}

/** Pull a card's Trello history: comments go to the Comments tab, everything else (joined/left, moves, due date, files, labels) to Activity. */
async function pullComments(task, card, ctx) {
  let actions;
  try {
    actions = await tGet(`/cards/${card.id}/actions`, { filter: ACTIVITY_TYPES, fields: 'date,data,type', member_fields: 'fullName,username', memberCreator_fields: 'fullName,username', limit: 1000 });
  } catch { return 0; } // never block the rest of the sync over one card's history
  let added = 0;
  const events = [];
  for (const act of actions) {
    if (act.type === 'commentCard') {
      if (!act?.data?.text) continue;
      if (await Comment.exists({ trelloCommentId: act.id })) continue; // already pulled by an earlier sync
      const userId = ctx.memberToUser.get(act.memberCreator?.id) || null;
      const c = new Comment({
        task: task._id, user: userId, body: act.data.text, source: 'trello', trelloCommentId: act.id,
        trelloAuthorName: userId ? undefined : (act.memberCreator?.fullName || act.memberCreator?.username || 'Trello'),
      });
      c.createdAt = new Date(act.date);
      c.updatedAt = new Date(act.date);
      try { await c.save({ timestamps: false }); added += 1; } catch (e) { if (e.code !== 11000) throw e; } // lost a race with another sync
      continue;
    }
    const summary = describeAction(act);
    if (!summary) continue;
    events.push({
      updateOne: {
        filter: { task: task._id, trelloActionId: act.id },
        update: { $setOnInsert: { task: task._id, trelloActionId: act.id, summary, actorName: act.memberCreator?.fullName || act.memberCreator?.username || 'Trello', at: new Date(act.date) } },
        upsert: true,
      },
    });
  }
  try { if (events.length) await TrelloActivity.bulkWrite(events, { ordered: false }); } catch (e) { if (e.code !== 11000) throw e; }
  await Task.updateOne({ _id: task._id }, { $set: { 'trello.activitySynced': true } }, { timestamps: false });
  return added;
}

/**
 * Pull the board: create / update tasks for cards (checklist items are not imported).
 * `auto` calls (background refresh) are skipped when a sync ran in the last 30 s.
 */
export async function pullBoard(project, { userId, auto = false } = {}) {
  const t = project.trello;
  if (!t?.boardId) throw bad('This project is not linked to a Trello board');
  if (auto && t.lastSyncAt && Date.now() - new Date(t.lastSyncAt).getTime() < 30000) return { skipped: 'recent' };

  // atomic lock: never run two syncs of the same project at once (a crashed run expires after 2 minutes)
  const locked = await Project.findOneAndUpdate(
    { _id: project._id, $or: [{ 'trello.syncing': null }, { 'trello.syncing': { $lt: new Date(Date.now() - 120000) } }] },
    { $set: { 'trello.syncing': new Date() } },
    { returnDocument: 'after' },
  );
  if (!locked) return { skipped: 'busy' };

  const result = { created: 0, updated: 0, unchanged: 0, subtasks: 0, removed: 0 };
  try {
    const board = await tGet(`/boards/${t.boardId}`, BOARD_PARAMS);
    const cards = await fetchAllCards(t.boardId, { includeClosed: true });
    let memberMap = await matchMembers(board.members);
    // Remember which Trello member each matched person is, and drop any old "needs a login" placeholder made for the same Trello member.
    for (const m of memberMap) {
      await User.updateOne({ _id: m.userId, trelloMemberId: null }, { $set: { trelloMemberId: m.trelloId } });
      await User.deleteMany({ pending: true, trelloMemberId: m.trelloId, _id: { $ne: m.userId } });
    }
    result.pendingUsers = (await createPendingUsers(board.members, memberMap)).length;
    if (result.pendingUsers) memberMap = await matchMembers(board.members); // the people just found are on this board's cards from this very sync
    const ctx = {
      lists: new Map(board.lists.map((l) => [l.id, l.name])),
      memberToUser: new Map(memberMap.map((m) => [m.trelloId, m.userId])),
      assignees: new Set(),
    };

    const existing = await Task.find({ project: project._id, 'trello.kind': 'card' });
    const byCard = new Map(existing.filter((x) => x.trello.kind === 'card').map((x) => [x.trello.cardId, x]));

    for (const card of cards) {
      let task = byCard.get(card.id);
      let cardChanged = false; // new, or edited in Trello since the last sync
      const wasRestricted = !!task?.restricted;
      const activity = new Date(card.dateLastActivity).getTime();
      if (!task) {
        if (card.closed) continue; // do not resurrect archived cards (e.g. ones deleted in Chronos)
        task = new Task({ project: project._id, createdBy: project.manager, priority: 'medium', status: 'todo' }); // a card pulled in from Trello belongs to the project manager, not to whoever happened to trigger the sync
        applyCard(task, card, ctx, true);
        task.estimateSeconds = null;
        await task.save();
        byCard.set(card.id, task);
        result.created += 1;
        cardChanged = true;
      } else if (task.trello.lastActivity?.getTime() !== activity) {
        applyCard(task, card, ctx, false);
        await task.save();
        result.updated += 1;
        cardChanged = true;
      } else {
        // a card member who has been approved since the last sync becomes the assignee of cards that still have none
        const mapped = (card.idMembers || []).map((id) => ctx.memberToUser.get(id)).filter(Boolean);
        // members who were not matched at import (not signed up / not approved yet) join the card once they are; additive, nothing is removed
        const have = new Set([task.assignee, ...(task.collaborators || [])].filter(Boolean).map(String));
        const missing = [...new Set(mapped.map(String))].filter((u) => !have.has(u));
        if (missing.length) {
          if (!task.assignee) task.assignee = missing.shift();
          task.collaborators = [...(task.collaborators || []), ...missing];
          task.markModified('assignee');
        }
        mapped.forEach((u) => ctx.assignees.add(String(u)));
        const restricted = (card.idMembers || []).length > 0 && !mapped.length && !task.assignee;
        if (card.idShort != null && task.trello.idShort !== card.idShort) { task.trello.idShort = card.idShort; task.markModified('trello'); } // fills in the Trello number for tickets synced before it was stored
        if (task.isModified() || restricted !== !!task.restricted) {
          task.restricted = restricted;
          await task.save();
          result.updated += 1;
        } else result.unchanged += 1;
      }
      if (!!task.restricted !== wasRestricted) {
        await Task.updateMany({ parent: task._id }, { $set: { restricted: !!task.restricted } }); // checklist subtasks follow their card
      }
      // comments -> Comments tab. Adding a comment in Trello bumps the card's dateLastActivity, so only cards that changed need
      // their comments re-read. (Doing it for EVERY card on EVERY sync cost one Trello request per card: ~15 s for 36 cards.)
      if (cardChanged || !task.trello?.activitySynced) result.comments = (result.comments || 0) + (await pullComments(task, card, ctx)); // also reads the history once for cards synced before it was kept

      // attachments -> Attachments section (always checked: already in memory from fetchAllCards, no extra API call)
      const nextAttachments = (card.attachments || []).map((a) => ({
        trelloId: a.id, name: a.name || 'attachment', url: a.url, bytes: a.bytes, mimeType: a.mimeType, date: a.date ? new Date(a.date) : null,
        previewUrl: a.previews?.length ? a.previews[a.previews.length - 1].url : null,
      }));
      if (JSON.stringify((task.attachments || []).map((a) => a.trelloId)) !== JSON.stringify(nextAttachments.map((a) => a.trelloId))) {
        task.attachments = nextAttachments;
        await task.save();
      }
      // Subtasks are internal to Chronos: Trello checklists are not imported, and Chronos subtasks are never sent to Trello.
    }

    // project metadata: lists, labels, member mapping; people on cards join the project team
    const joined = new Set((project.members || []).map(String));
    const extra = [...ctx.assignees].filter((id) => !joined.has(id));
    await Project.updateOne({ _id: project._id }, {
      $set: {
        'trello.name': board.name, 'trello.url': board.url, 'trello.shortLink': board.shortLink,
        'trello.lists': board.lists.map((l) => ({ id: l.id, name: l.name })),
        'trello.labels': board.labels.map((l) => ({ id: l.id, name: l.name || '', color: l.color || '' })),
        'trello.memberMap': memberMap, 'trello.lastSyncAt': new Date(), 'trello.syncError': null,
      },
      ...(extra.length ? { $addToSet: { members: { $each: extra } } } : {}),
    });
    return result;
  } catch (e) {
    await Project.updateOne({ _id: project._id }, { $set: { 'trello.syncError': String(e.message).slice(0, 200) } });
    throw e;
  } finally {
    await Project.updateOne({ _id: project._id }, { $set: { 'trello.syncing': null } });
  }
}

/** Create a Chronos project from a Trello board and pull everything into it. */
export async function importBoard(user, input) {
  const ref = parseBoardRef(input);
  const board = await tGet(`/boards/${ref}`, BOARD_PARAMS);
  if (board.closed) throw bad('That Trello board is archived');
  if (await Project.exists({ 'trello.boardId': board.id })) throw bad('This Trello board is already imported. Open it from the Projects page and use Sync now.');
  const project = await Project.create({
    name: board.name, description: `Imported from Trello: ${board.url}`, manager: user._id, members: [user._id], status: 'active', color: '#0079bf',
    trello: {
      boardId: board.id, shortLink: board.shortLink, url: board.url, name: board.name,
      lists: board.lists.map((l) => ({ id: l.id, name: l.name })),
      labels: board.labels.map((l) => ({ id: l.id, name: l.name || '', color: l.color || '' })),
    },
  });
  await audit(user, 'project.create', 'Project', project, `Imported project "${project.name}" from Trello`, { project: project._id });
  const result = await pullBoard(project, { userId: user._id });
  return { project: await Project.findById(project._id), result };
}

// ------------------------------------------------------------------ Chronos -> Trello

async function markError(project, e) {
  console.error('Trello push failed:', e.message);
  await Project.updateOne({ _id: project._id }, { $set: { 'trello.syncError': `Could not update Trello: ${String(e.message).slice(0, 160)}` } }).catch(() => {});
}

async function rememberCard(task, card, extra = {}) {
  await Task.updateOne({ _id: task._id }, {
    $set: {
      'trello.lastActivity': new Date(card.dateLastActivity),
      'trello.snapshot.closed': !!card.closed, 'trello.snapshot.dueComplete': !!card.dueComplete,
      'trello.snapshot.idMembers': [...(card.idMembers || [])].sort(), ...extra,
    },
  });
}

/** Trello member ids for a task's assignee + collaborators (only people we can map), keeping unmapped Trello members as they are. */
function memberIdsFor(task, project) {
  const toTrello = new Map((project.trello.memberMap || []).map((m) => [String(m.userId), m.trelloId]));
  const mappedUsers = new Set(toTrello.values());
  const wanted = [task.assignee, ...(task.collaborators || [])].map((u) => toTrello.get(String(u?._id || u))).filter(Boolean);
  const current = task.trello?.snapshot?.idMembers || [];
  const keep = current.filter((id) => !mappedUsers.has(id));
  // nobody mappable and nobody of ours on the card: leave Trello's members alone. If we removed everyone we had put there, clear them.
  if (!wanted.length && keep.length === current.length) return null;
  return [...new Set([...wanted, ...keep])];
}

/** Push the changed fields of an existing task to its card / checklist item. `what` = { title, description, deadline, stage, labels, status, assignee }. */
export async function pushTask(task, project, what) {
  if (!isLinked(project) || !task.trello?.cardId) return;
  try {
    if (task.trello.kind === 'item') return; // subtasks are internal: edits never go back to the Trello checklist
    const upd = {};
    if (what.title) upd.name = task.title;
    if (what.description) upd.desc = task.description || '';
    if (what.deadline) upd.due = task.deadline ? new Date(task.deadline).toISOString() : null;
    if (what.stage) upd.idList = task.trello.idList;
    if (what.labels) upd.idLabels = (task.labels || []).map((l) => l.trelloId).filter(Boolean).join(',');
    if (what.status) { upd.closed = task.status === 'cancelled'; upd.dueComplete = task.status === 'completed' && !!task.deadline; }
    if (what.assignee) { const ids = memberIdsFor(task, project); if (ids) upd.idMembers = ids.join(','); }
    if (!Object.keys(upd).length) return;
    // Trello ignores `due: null` in a JSON body; an empty `due` query value is what clears the date
    const params = {};
    if (upd.due === null) { delete upd.due; params.due = ''; }
    const card = await tPut(`/cards/${task.trello.cardId}`, upd, params);
    await rememberCard(task, card);
  } catch (e) { await markError(project, e); }
}

/** A task created in Chronos becomes a card (in the chosen list, or the first list). */
export async function createCardFor(task, project, stageId) {
  if (!isLinked(project) || task.parent) return;
  try {
    const lists = project.trello.lists || [];
    const list = lists.find((l) => l.id === stageId) || lists[0];
    if (!list) return;
    const memberIds = memberIdsFor(task, project);
    const card = await tPost('/cards', {
      idList: list.id, name: task.title, desc: task.description || '', pos: 'bottom',
      due: task.deadline ? new Date(task.deadline).toISOString() : null,
      idLabels: (task.labels || []).map((l) => l.trelloId).filter(Boolean).join(','),
      ...(memberIds ? { idMembers: memberIds.join(',') } : {}),
    });
    await Task.updateOne({ _id: task._id }, {
      $set: {
        stage: list.name,
        trello: { kind: 'card', cardId: card.id, shortUrl: card.shortUrl, idShort: card.idShort, idList: list.id, lastActivity: new Date(card.dateLastActivity), snapshot: { closed: false, dueComplete: false, idMembers: [...(card.idMembers || [])].sort() } },
      },
    });
  } catch (e) { await markError(project, e); }
}

/** Deleting a task archives its card in Trello (nothing is destroyed there). */
export async function archiveCardFor(task, project) {
  if (!isLinked(project) || task.trello?.kind !== 'card') return;
  try { await tPut(`/cards/${task.trello.cardId}`, { closed: true }); } catch (e) { await markError(project, e); }
}
