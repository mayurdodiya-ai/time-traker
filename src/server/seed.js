import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, Project, Task, TimeEntry, TimerSession, Comment, AuditEvent, Notification } from './models/index.js';
import { todayStr, addDays, workDateOf } from './util.js';

const PASSWORD = 'Password@123';
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const H = 3600;
const inDays = (n) => new Date(Date.now() + n * 864e5);

await mongoose.connect(process.env.MONGODB_URI);
// SAFETY: the seed WIPES the database. Never run it against a database that already has users unless forced.
if ((await User.countDocuments()) > 0 && !process.argv.includes('--force')) {
  console.error(`Refusing to seed: database "${mongoose.connection.name}" already contains users, and seeding would delete ALL of its data.
If you really mean it, run:  node src/server/seed.js --force
(For tests, point MONGODB_URI at a throwaway database first.)`);
  await mongoose.disconnect();
  process.exit(1);
}
await Promise.all([User, Project, Task, TimeEntry, TimerSession, Comment, AuditEvent, Notification].map((m) => m.deleteMany({})));
await mongoose.syncIndexes();

const hash = await bcrypt.hash(PASSWORD, 10);
const mk = (name, email, role, title, color, extra = {}) => ({ name, email, role, title, color, passwordHash: hash, ...extra });
const [olivia, raj, maria, priya, sam, lena, dev] = await User.create([
  mk('Olivia Hart', 'olivia@acme.test', 'owner', 'Company Owner', '#8b5cf6'),
  mk('Raj Mehta', 'raj@acme.test', 'manager', 'Project Manager', '#6366f1'),
  mk('Maria Lopez', 'maria@acme.test', 'manager', 'Project Manager', '#ec4899'),
  mk('Priya Nair', 'priya@acme.test', 'employee', 'Senior Developer', '#14b8a6'),
  mk('Sam Carter', 'sam@acme.test', 'employee', 'Backend Engineer', '#f59e0b'),
  mk('Lena Fischer', 'lena@acme.test', 'employee', 'Product Designer', '#0ea5e9'),
  mk('Dev Patel', 'dev@acme.test', 'viewer', 'Stakeholder (read-only)', '#64748b'),
]);

const [web, mobile, tools] = await Project.create([
  { name: 'Website Redesign', description: 'Modernise the marketing site and add a secure employee portal login.', manager: raj._id, lead: priya._id, members: [raj._id, priya._id, sam._id, lena._id, dev._id], status: 'active', startDate: inDays(-30), targetDate: inDays(21), color: '#6366f1' },
  { name: 'Mobile App v2', description: 'Second generation customer app with push notifications and offline mode.', manager: maria._id, lead: sam._id, members: [maria._id, sam._id, lena._id, priya._id], status: 'active', startDate: inDays(-20), targetDate: inDays(-3), color: '#ec4899' },
  { name: 'Internal Tools', description: 'Small automation tools for finance and HR.', manager: raj._id, members: [raj._id, sam._id], status: 'planning', startDate: inDays(7), targetDate: inDays(60), color: '#14b8a6' },
]);

let order = 0;
const T = (project, title, o) => Task.create({ project: project._id, title, order: order++, createdBy: project.manager, ...o });
const ES = (h) => h * H;

// ---- Website Redesign
const login = await T(web, 'Develop the employee login module', { assignee: priya._id, collaborators: [sam._id], priority: 'high', status: 'in_progress', estimateSeconds: ES(12), deadline: inDays(5), description: 'Secure sign-in with invitation onboarding and password reset.', criteria: 'Users can sign in/out, reset passwords, and inactive users are blocked.' });
const subs = [];
for (const [title, who, est, status] of [
  ['Design the login screen', lena, 3, 'completed'],
  ['Integrate the authentication API', sam, 5, 'in_progress'],
  ['Implement input validation', priya, 2, 'todo'],
  ['Test the login flow', sam, 2, 'todo'],
]) subs.push(await T(web, title, { parent: login._id, assignee: who._id, estimateSeconds: ES(est), status, priority: 'medium', deadline: inDays(4), completedAt: status === 'completed' ? new Date() : null }));
const hero = await T(web, 'Homepage hero section', { assignee: lena._id, priority: 'medium', status: 'in_review', estimateSeconds: ES(10), deadline: inDays(2) });
const seo = await T(web, 'SEO audit & fixes', { assignee: sam._id, priority: 'low', status: 'todo', estimateSeconds: ES(6), deadline: inDays(-2) });
const migrate = await T(web, 'Content migration', { assignee: priya._id, priority: 'urgent', status: 'blocked', estimateSeconds: ES(16), deadline: inDays(9), description: 'Blocked: waiting for final copy from marketing.' });
const style = await T(web, 'Brand style guide', { assignee: lena._id, priority: 'medium', status: 'completed', estimateSeconds: ES(8), completedAt: inDays(-4) });
await T(web, 'Cookie consent banner', { assignee: null, priority: 'low', status: 'todo' });

// ---- Mobile App v2
const push = await T(mobile, 'Push notification service', { assignee: sam._id, priority: 'urgent', status: 'in_progress', estimateSeconds: ES(20), deadline: inDays(-1) });
const pushSubs = [];
for (const [title, who, est, status] of [['Set up FCM / APNs credentials', sam, 8, 'completed'], ['Notification preferences screen', lena, 12, 'in_progress']])
  pushSubs.push(await T(mobile, title, { parent: push._id, assignee: who._id, estimateSeconds: ES(est), status, priority: 'medium', completedAt: status === 'completed' ? new Date() : null }));
const onboard = await T(mobile, 'Onboarding flow', { assignee: lena._id, priority: 'high', status: 'in_progress', estimateSeconds: ES(14), deadline: inDays(3) });
const offline = await T(mobile, 'Offline sync engine', { assignee: sam._id, priority: 'high', status: 'todo', estimateSeconds: ES(24), deadline: inDays(12) });
await T(mobile, 'App store release checklist', { assignee: priya._id, priority: 'medium', status: 'todo', estimateSeconds: 0 });

// ---- Internal Tools
await T(tools, 'Expense approval dashboard', { assignee: sam._id, priority: 'medium', status: 'todo', estimateSeconds: ES(30), deadline: inDays(40) });

// ---- Time entries: ~3 weeks of realistic history
const byUser = { [priya._id]: [login, ...subs.filter((s) => String(s.assignee) === String(priya._id)), migrate, hero], [sam._id]: [...subs.filter((s) => String(s.assignee) === String(sam._id)), seo, push, pushSubs[0], offline], [lena._id]: [subs[0], hero, style, onboard, pushSubs[1]] };
const people = { [priya._id]: priya, [sam._id]: sam, [lena._id]: lena };
const projectOf = new Map([...Object.values(byUser).flat()].map((t) => [String(t._id), t.project]));
const today = todayStr();
const entries = [];
for (let back = 20; back >= 0; back--) {
  const day = addDays(today, -back);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) continue;
  for (const [uid, tasks] of Object.entries(byUser)) {
    if (rnd() < 0.08) continue; // an occasional day off
    let cursor = new Date(`${day}T09:${pick(['00', '10', '20'])}:00`).getTime();
    const n = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const task = pick(tasks);
      const seconds = Math.round((0.6 + rnd() * 2.2) * H / 60) * 60;
      const manual = rnd() < 0.2;
      const startedAt = new Date(cursor);
      const endedAt = new Date(cursor + seconds * 1000);
      cursor = endedAt.getTime() + (10 + Math.floor(rnd() * 25)) * 60000;
      if (back === 0 && endedAt > new Date()) continue;
      const approvalStatus = back > 9 ? 'approved' : back > 4 ? (rnd() < 0.12 ? 'rejected' : 'submitted') : 'draft';
      entries.push({
        user: uid, project: projectOf.get(String(task._id)), task: task._id, workDate: workDateOf(startedAt), startedAt, endedAt,
        durationSeconds: seconds, source: manual ? 'manual' : 'timer', approvalStatus,
        description: pick(['Implementation work', 'Code review fixes', 'Pairing session', 'Stakeholder feedback', 'Bug fixing', 'Research & spike', 'Unit tests', '']),
        reviewNote: approvalStatus === 'rejected' ? 'Please add a clearer description of the work done.' : undefined,
        reviewedBy: approvalStatus === 'approved' || approvalStatus === 'rejected' ? raj._id : undefined,
        history: [{ at: startedAt, by: uid, change: manual ? 'Manual entry created' : 'Recorded by timer' }],
      });
    }
  }
}
await TimeEntry.insertMany(entries);

await Comment.create([
  { task: login._id, user: raj._id, body: 'Let’s make sure inactive accounts are blocked at the API level, not just the UI.' },
  { task: login._id, user: priya._id, body: 'Agreed — I’ll add the check to the auth middleware and cover it with a test.' },
  { task: migrate._id, user: priya._id, body: 'Blocked until marketing sends the final copy. Pinged them today.' },
]);
await Notification.create([
  { user: priya._id, text: 'Raj Mehta assigned you “Develop the employee login module”', link: `/projects/${web._id}?task=${login._id}` },
  { user: priya._id, text: '2 time entries were rejected by Raj Mehta — “Please add a clearer description”', link: '/time' },
  { user: raj._id, text: 'Sam Carter submitted 6 time entries for review', link: '/approvals' },
]);
await AuditEvent.create([
  { actor: olivia._id, action: 'project.create', entityType: 'Project', entityId: String(web._id), project: web._id, summary: 'Created project "Website Redesign"' },
  { actor: raj._id, action: 'task.create', entityType: 'Task', entityId: String(login._id), project: web._id, summary: 'Created task "Develop the employee login module"' },
]);

console.log(`Seeded ${entries.length} time entries.\nSign in with any of:\n  olivia@acme.test (owner)\n  raj@acme.test / maria@acme.test (managers)\n  priya@acme.test / sam@acme.test / lena@acme.test (employees)\n  dev@acme.test (viewer)\nPassword: ${PASSWORD}`);
await mongoose.disconnect();
