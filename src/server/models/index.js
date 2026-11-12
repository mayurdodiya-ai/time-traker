import mongoose from 'mongoose';

const { Schema } = mongoose;
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema); // safe across hot reloads
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });

const clean = {
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
};
const opts = { timestamps: true, toJSON: clean, toObject: clean };

// A tiny counter collection: one document per sequence. Used for ticket numbers (atomic, so two requests never get the same number).
export const Counter = model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));
export async function nextTicketNumber() {
  const c = await Counter.findOneAndUpdate({ _id: 'ticket' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return c.seq;
}

export const ROLES = ['owner', 'manager', 'employee', 'viewer'];
export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'employee' },
    title: { type: String, default: '' },
    color: { type: String, default: '#6366f1' },
    active: { type: Boolean, default: true },
    pending: { type: Boolean, default: false }, // self-registered, waiting for admin approval
    trelloMemberId: { type: String, default: null }, // set when the account was created from a Trello board member
    trelloIgnored: { type: Boolean, default: false }, // the admin chose not to give this Trello member a login: hidden from the People list
  },
  opts,
);
export const User = model('User', userSchema);

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    manager: ref('User', { required: true }),
    lead: ref('User', { default: null }),
    members: [ref('User')],
    status: { type: String, enum: PROJECT_STATUSES, default: 'planning' },
    startDate: Date,
    targetDate: Date,
    color: { type: String, default: '#6366f1' },
    // Board lists that exist ONLY in Chronos (e.g. Backlog). Tasks in them keep their Trello card wherever it already is; Trello never sees these lists.
    // Board columns of a project WITHOUT Trello are the task statuses. A project can show its own name for a column and hide a column it does not use.
    statusLabels: { type: Schema.Types.Mixed, default: {} }, // { in_progress: 'Doing' }
    hiddenStatuses: [String], // statuses whose (empty) column is hidden on the board
    localLists: [{ _id: false, id: String, name: String, createdBy: String }], // createdBy: user id of whoever added the list
    // Set when the project is linked to a Trello board
    trello: {
      type: new Schema(
        {
          boardId: String,
          shortLink: String,
          url: String,
          name: String,
          lists: [{ _id: false, id: String, name: String }],
          labels: [{ _id: false, id: String, name: String, color: String }],
          memberMap: [{ _id: false, trelloId: String, userId: ref('User') }], // Trello member <-> Chronos user
          lastSyncAt: Date,
          syncing: Date, // lock so two syncs never run at once
          syncError: String,
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  opts,
);
export const Project = model('Project', projectSchema);

const taskSchema = new Schema(
  {
    project: ref('Project', { required: true, index: true }),
    parent: ref('Task', { default: null, index: true }),
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    criteria: { type: String, default: '' },
    assignee: ref('User', { default: null, index: true }),
    collaborators: [ref('User')],
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    deadline: Date,
    // null = no estimate, 0 = explicit zero-hour estimate (the PRD requires these to differ)
    estimateSeconds: { type: Number, default: null, min: 0 },
    required: { type: Boolean, default: true },
    createdBy: ref('User'),
    completedAt: Date,
    order: { type: Number, default: 0 },
    ticketNumber: { type: Number, default: null }, // unique, never reused: shown as CH-<number>
    ticketCode: { type: String, default: '' }, // subtasks only: parent code + running number, e.g. CH-75.1 (never reused)
    subSeq: { type: Number, default: 0 }, // tasks only: how many sub-tickets have been issued under this ticket
    stage: { type: String, default: '' }, // name of the list the task shows in (a Trello list, or a Chronos-only list when localStage is set)
    chronosOnly: { type: Boolean, default: false }, // never sent to Trello (no card) until someone chooses "Add to Trello"
    localStage: { type: String, default: null }, // the board list the task shows in when it is NOT following its Trello card: a Chronos-only list (card-backed tasks keep their card where it is) or, for a Chronos-only task, any list
    restricted: { type: Boolean, default: false }, // assigned only to Trello members who are not approved yet: visible to the admin only
    labels: [{ _id: false, trelloId: String, name: String, color: String }],
    // Trello attachments on this task's card (kind: 'card' only — subtasks share their parent card's attachments and don't carry their own).
    attachments: [{ _id: false, trelloId: String, name: String, url: String, previewUrl: String, bytes: Number, mimeType: String, date: Date }],
    trello: {
      type: new Schema(
        {
          kind: { type: String, enum: ['card', 'item'] }, // card = a Trello card, item = a checklist item shown as a subtask
          cardId: String,
          checklistId: String, // the checklist the item lives in (only set for kind: 'item')
          checkItemId: String,
          shortUrl: String,
          activitySynced: Boolean, // the card's Trello history has been read at least once
          idShort: Number, // the card's own number in Trello (the #12 Trello shows), so people can match a ticket to its card
          idList: String,
          lastActivity: Date, // card.dateLastActivity at the last sync (used to detect changes made in Trello)
          snapshot: { closed: Boolean, dueComplete: Boolean, done: Boolean, idMembers: [String], idMember: String }, // idMember: the Trello member assigned to this checklist item (kind: 'item' only)
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  opts,
);
// a Trello card / checklist item can exist only once per project, even if two syncs race
taskSchema.index({ project: 1, 'trello.cardId': 1 }, { unique: true, partialFilterExpression: { 'trello.kind': 'card' }, name: 'one_task_per_card' });
taskSchema.index({ project: 1, 'trello.checkItemId': 1 }, { unique: true, partialFilterExpression: { 'trello.kind': 'item' }, name: 'one_task_per_check_item' });
// every ticket (task or subtask) gets the next number when it is created, whichever way it is created (app, Excel import, Trello sync)
taskSchema.index({ ticketNumber: 1 }, { unique: true, partialFilterExpression: { ticketNumber: { $type: 'number' } }, name: 'unique_ticket_number' });
taskSchema.pre('validate', async function assignTicketNumber() {
  if (this.isNew && this.ticketNumber == null) this.ticketNumber = await nextTicketNumber();
  if (this.isNew && this.parent && !this.ticketCode) {
    const p = await this.constructor.findByIdAndUpdate(this.parent, { $inc: { subSeq: 1 } }, { returnDocument: 'after', timestamps: false }).select('ticketNumber subSeq');
    if (p?.ticketNumber) this.ticketCode = `CH-${p.ticketNumber}.${p.subSeq}`;
  }
});
export const Task = model('Task', taskSchema);

const timeEntrySchema = new Schema(
  {
    user: ref('User', { required: true, index: true }),
    project: ref('Project', { required: true, index: true }),
    task: ref('Task', { required: true, index: true }),
    workDate: { type: String, required: true, index: true }, // YYYY-MM-DD in company timezone
    startedAt: Date,
    endedAt: Date,
    durationSeconds: { type: Number, required: true, min: 1 },
    description: { type: String, default: '' },
    source: { type: String, enum: ['timer', 'manual'], required: true },
    approvalStatus: {
      type: String,
      enum: ['draft', 'submitted', 'approved', 'rejected'],
      default: 'draft',
      index: true,
    },
    reviewNote: String,
    reviewedBy: ref('User'),
    reviewedAt: Date,
    overlap: { type: Boolean, default: false },
    clientId: String, // idempotency key for retried requests
    history: [{ at: Date, by: ref('User'), change: String }],
  },
  opts,
);
timeEntrySchema.index({ user: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
export const TimeEntry = model('TimeEntry', timeEntrySchema);

const timerSchema = new Schema(
  {
    user: ref('User', { required: true }),
    project: ref('Project', { required: true }),
    task: ref('Task', { required: true }),
    state: { type: String, enum: ['running', 'paused'], required: true },
    segmentStart: { type: Date, required: true }, // start of the current running segment (server time)
    accumulatedSeconds: { type: Number, default: 0 }, // seconds banked from earlier segments
    firstStartedAt: { type: Date, required: true },
    description: { type: String, default: '' },
  },
  opts,
);
timerSchema.index({ user: 1, task: 1 }, { unique: true });
// Database-level guarantee: at most ONE running timer per employee, even with concurrent requests.
timerSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { state: 'running' }, name: 'one_running_per_user' });
export const TimerSession = model('TimerSession', timerSchema);

const commentSchema = new Schema(
  {
    task: ref('Task', { required: true, index: true }),
    user: ref('User'), // unset for a Trello comment whose author has no matching Chronos account
    body: { type: String, required: true },
    source: { type: String, enum: ['chronos', 'trello'], default: 'chronos' },
    trelloCommentId: String, // Trello's action id, so re-syncing never creates a duplicate
    trelloAuthorName: String, // shown instead of `user.name` when the author could not be matched
    editedAt: Date, // set when the author edits the comment
  },
  opts,
);
commentSchema.index({ task: 1, trelloCommentId: 1 }, { unique: true, partialFilterExpression: { trelloCommentId: { $type: 'string' } } });
export const Comment = model('Comment', commentSchema);

// Things that happened on the Trello card itself (joined / left the card, moved, due date, attachments, labels...), shown in the ticket's Activity tab.
const trelloActivitySchema = new Schema(
  {
    task: ref('Task', { required: true, index: true }),
    trelloActionId: { type: String, required: true },
    summary: { type: String, required: true },
    actorName: String,
    at: { type: Date, required: true },
  },
  opts,
);
trelloActivitySchema.index({ task: 1, trelloActionId: 1 }, { unique: true });
export const TrelloActivity = model('TrelloActivity', trelloActivitySchema);

export const AuditEvent = model(
  'AuditEvent',
  new Schema(
    {
      actor: ref('User'),
      action: { type: String, index: true },
      entityType: String,
      entityId: String,
      project: ref('Project'),
      summary: String,
      meta: Schema.Types.Mixed,
    },
    opts,
  ),
);

export const Notification = model(
  'Notification',
  new Schema(
    { user: ref('User', { required: true, index: true }), text: String, link: String, read: { type: Boolean, default: false } },
    opts,
  ),
);
