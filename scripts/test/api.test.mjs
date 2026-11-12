// Integration checks for the PRD's critical rules. Run with the API up and freshly seeded:  node test/api.test.mjs
const BASE = process.env.API || 'http://localhost:3000/api';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}${cond ? '' : ' ' + extra}`); };
 
async function call(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* csv etc */ }
  return { status: r.status, data };
}
const login = async (email) => (await call(null, 'POST', '/auth/login', { email, password: 'Password@123' })).data.token;

const [priyaT, samT, lenaT, rajT, oliviaT, devT, mariaT] = await Promise.all(
  ['priya', 'sam', 'lena', 'raj', 'olivia', 'dev', 'maria'].map((n) => login(`${n}@acme.test`)),
);

console.log('Auth & access');
ok('bad password rejected', (await call(null, 'POST', '/auth/login', { email: 'priya@acme.test', password: 'nope' })).status === 400);
ok('no token => 401', (await call(null, 'GET', '/projects')).status === 401);
const priyaProjects = (await call(priyaT, 'GET', '/projects')).data;
ok('employee sees only her projects (no Internal Tools)', priyaProjects.length === 2 && !priyaProjects.some((p) => p.name === 'Internal Tools'));
const tools = (await call(oliviaT, 'GET', '/projects')).data.find((p) => p.name === 'Internal Tools');
ok('owner sees all projects (at least the 3 seeded ones)', (await call(oliviaT, 'GET', '/projects')).data.length >= 3);
ok('URL tampering: employee cannot open unauthorized project', (await call(priyaT, 'GET', `/projects/${tools.id}`)).status === 404);
ok('manager cannot see another manager\'s project', (await call(mariaT, 'GET', `/projects/${tools.id}`)).status === 404);
ok('employee cannot create project', (await call(priyaT, 'POST', '/projects', { name: 'x' })).status === 403);
ok('employee cannot read audit log', (await call(priyaT, 'GET', '/audit')).status === 403);

const tasks = (await call(priyaT, 'GET', '/tasks?project=' + priyaProjects.find((p) => p.name === 'Website Redesign').id)).data;
const login_ = tasks.find((t) => t.title.startsWith('Develop the employee'));
const subs = tasks.filter((t) => t.parent === login_.id || String(t.parent) === login_.id);
ok('login task has 4 subtasks', subs.length === 4);
ok('subtask in same project as parent', subs.every((s) => s.project.id === login_.project.id));
ok('subtasks have different assignees than parent', new Set(subs.map((s) => s.assignee?.name)).size > 1);

console.log('Task rules');
let r = await call(priyaT, 'PATCH', `/tasks/${login_.id}`, { status: 'completed' });
ok('cannot complete parent with open required subtasks (409)', r.status === 409 && r.data.code === 'SUBTASKS_INCOMPLETE', JSON.stringify(r.data));
r = await call(rajT, 'PATCH', `/tasks/${login_.id}`, { status: 'completed' });
ok('manager needs a reason to override', r.status === 409);
const allWeb = (await call(rajT, 'GET', '/tasks?project=' + priyaProjects.find((p) => p.name === 'Website Redesign').id)).data;
const seoT = allWeb.find((x) => x.title.startsWith('SEO'));
r = await call(samT, 'PATCH', `/tasks/${seoT.id}`, { title: 'hacked', priority: 'low' });
ok('assignee cannot edit fields other than status', r.status === 403);
const outsider = (await call(oliviaT, 'GET', '/users')).data.find((u) => u.email === 'dev@acme.test');
r = await call(rajT, 'PATCH', `/tasks/${login_.id}`, { assignee: (await call(oliviaT, 'GET', '/users')).data.find((u) => u.name === 'Maria Lopez').id });
ok('cannot assign to non-team member', r.status === 400);

console.log('(setup) give seeded tasks headroom: demo time already exceeds some estimates');
{
  const everything = (await call(oliviaT, 'GET', '/tasks')).data;
  const hasKids = (t) => everything.some((y) => y.parent === t.id);
  for (const t of everything.filter((x) => !x.parent && x.estimateSeconds > 0 && !hasKids(x))) await call(oliviaT, 'PATCH', `/tasks/${t.id}`, { estimateSeconds: t.estimateSeconds + 1000 * 3600 });
  for (const t of everything.filter((x) => x.parent && x.estimateSeconds > 0)) await call(oliviaT, 'PATCH', `/tasks/${t.id}`, { estimateSeconds: t.estimateSeconds + 100 * 3600 }); // parents follow automatically
}

console.log('Timer engine');
const [a, b] = [tasks.find((t) => t.title === 'Content migration'), subs.find((s) => s.title.startsWith('Implement'))];
await call(priyaT, 'POST', '/timer/stop', {}); // clean slate
let t = await call(priyaT, 'POST', '/timer/start', { taskId: a.id });
ok('start timer', t.status === 200 && t.data.sessions.some((s) => s.state === 'running'));
const again = await call(priyaT, 'POST', '/timer/start', { taskId: a.id });
ok('repeated start is idempotent (still 1 session)', again.data.sessions.length === 1);
await new Promise((r) => setTimeout(r, 1500));
t = await call(priyaT, 'POST', '/timer/start', { taskId: b.id });
ok('starting a 2nd timer auto-pauses the 1st & says so', t.data.pausedPrevious?.taskId === a.id && t.data.sessions.filter((s) => s.state === 'running').length === 1);
const paused = t.data.sessions.find((s) => s.task.id === a.id);
ok('paused timer retains recorded duration (>=1s)', paused.state === 'paused' && paused.accumulatedSeconds >= 1, paused.accumulatedSeconds);

// concurrent starts on 4 different tasks => exactly one running afterwards
const others = tasks.filter((x) => x.assignee?.name === 'Priya Nair' && !['completed'].includes(x.status)).slice(0, 4);
await Promise.all(others.map((x) => call(priyaT, 'POST', '/timer/start', { taskId: x.id })));
const snap = (await call(priyaT, 'GET', '/timer')).data;
ok('concurrent starts never produce overlapping running timers', snap.sessions.filter((s) => s.state === 'running').length <= 1, JSON.stringify(snap.sessions.map((s) => s.state)));

const running = snap.sessions.find((s) => s.state === 'running');
const stops = await Promise.all([1, 2, 3].map(() => call(priyaT, 'POST', '/timer/stop', { taskId: running.task.id })));
const created = stops.filter((s) => s.data.entry).length;
ok('triple stop creates at most one time entry (no duplicates)', created <= 1, created);
await call(priyaT, 'POST', '/timer/stop', { taskId: a.id });
await call(priyaT, 'POST', '/timer/stop', { taskId: b.id });
const clean = (await call(priyaT, 'POST', '/timer/stop', {})).data;
ok('timer state persisted server-side (GET after "restart")', Array.isArray((await call(priyaT, 'GET', '/timer')).data.sessions));
ok('viewer cannot start a timer', (await call(devT, 'POST', '/timer/start', { taskId: a.id })).status === 403);

console.log('Manual entries');
const today = new Date().toLocaleDateString('en-CA');
const cid = 'test-' + Date.now();
const m1 = await call(priyaT, 'POST', '/time-entries', { taskId: b.id, workDate: today, durationSeconds: 5400, description: 'test', clientId: cid, startedAt: new Date(Date.now() - 6 * 3600e3).toISOString() });
const m2 = await call(priyaT, 'POST', '/time-entries', { taskId: b.id, workDate: today, durationSeconds: 5400, description: 'test', clientId: cid });
ok('manual entry created', m1.status === 201);
ok('retry with same clientId does not duplicate', m2.data.duplicate === true && m2.data.entry.id === m1.data.entry.id);
ok('duration < 1 min rejected', (await call(priyaT, 'POST', '/time-entries', { taskId: b.id, workDate: today, durationSeconds: 10 })).status === 400);
ok('future date rejected', (await call(priyaT, 'POST', '/time-entries', { taskId: b.id, workDate: '2999-01-01', durationSeconds: 600 })).status === 400);
const ov = await call(priyaT, 'POST', '/time-entries', { taskId: b.id, workDate: today, durationSeconds: 3600, startedAt: new Date(Date.now() - 6 * 3600e3 + 600e3).toISOString() });
ok('overlapping manual entry is flagged (not silently accepted)', ov.data.overlap === true);
ok('cannot log time on a project you are not in', (await call(lenaT, 'POST', '/time-entries', { taskId: (await call(oliviaT, 'GET', '/tasks?project=' + tools.id)).data[0].id, workDate: today, durationSeconds: 600 })).status === 201 ? false : true);

console.log('Totals & approvals');
const full = (await call(priyaT, 'GET', `/tasks/${login_.id}`)).data;
const sumSubs = full.subtasks.reduce((s, x) => s + x.totals.direct, 0);
ok('parent total = direct + subtasks', full.task.totals.total === full.task.totals.direct + sumSubs && full.task.totals.children === sumSubs);
ok('subtask totals are NOT zero after time was logged (regression: string vs ObjectId)', full.subtasks.some((x) => x.totals.direct > 0), JSON.stringify(full.subtasks.map((x) => x.totals.direct)));
ok('task totals equal the sum of its listed entries', full.task.totals.total === full.entries.reduce((a, e) => a + e.durationSeconds, 0), `${full.task.totals.total} vs ${full.entries.reduce((a, e) => a + e.durationSeconds, 0)}`);
const listed = (await call(priyaT, 'GET', '/tasks?project=' + login_.project.id)).data.find((x) => x.id === login_.id);
ok('task list totals match task detail totals', listed.totals.total === full.task.totals.total, `${listed.totals.total} vs ${full.task.totals.total}`);
const dash = (await call(priyaT, 'GET', '/dashboard')).data;
ok('dashboard task totals are not zero', dash.me.tasks.some((x) => x.totals.total > 0));
const proj = (await call(rajT, 'GET', `/projects/${login_.project.id}`)).data;
const rep = (await call(rajT, 'GET', `/reports/summary?project=${login_.project.id}&from=2000-01-01&to=2999-01-01`)).data;
ok('project actual (no double count) == report total', proj.stats.actual === rep.totalSeconds, `${proj.stats.actual} vs ${rep.totalSeconds}`);
const sub = await call(priyaT, 'POST', '/time-entries/submit', { ids: [m1.data.entry.id] });
ok('employee submits entry', sub.data.submitted === 1);
ok('submitted entry is locked for the employee', (await call(priyaT, 'PATCH', `/time-entries/${m1.data.entry.id}`, { description: 'x' })).status === 403);
ok('project manager cannot approve (only the admin can)', (await call(rajT, 'POST', '/time-entries/approvals/review', { ids: [m1.data.entry.id], decision: 'approved' })).status === 403);
ok('project manager has no approval queue', (await call(rajT, 'GET', '/time-entries/approvals/queue')).status === 403);
ok('employee cannot approve', (await call(priyaT, 'POST', '/time-entries/approvals/review', { ids: [m1.data.entry.id], decision: 'approved' })).status === 403);
ok('rejection requires a note', (await call(oliviaT, 'POST', '/time-entries/approvals/review', { ids: [m1.data.entry.id], decision: 'rejected' })).status === 400);
ok('admin approves', (await call(oliviaT, 'POST', '/time-entries/approvals/review', { ids: [m1.data.entry.id], decision: 'approved' })).data.reviewed === 1);
ok('approved entry cannot be silently changed by employee', (await call(priyaT, 'PATCH', `/time-entries/${m1.data.entry.id}`, { description: 'x' })).status === 403);
ok('approved entry cannot be deleted', (await call(priyaT, 'DELETE', `/time-entries/${m1.data.entry.id}`)).status === 403);
ok('owner correction requires a reason', (await call(oliviaT, 'PATCH', `/time-entries/${m1.data.entry.id}`, { durationSeconds: 3600 })).status === 403);
ok('owner correction with reason is accepted & audited', (await call(oliviaT, 'PATCH', `/time-entries/${m1.data.entry.id}`, { durationSeconds: 3600, reason: 'Wrong duration' })).status === 200);

console.log('Self-service tasks');
const webId = login_.project.id;
const priyaId = login_.assignee.id;
const mine = await call(lenaT, 'POST', '/tasks', { project: webId, title: 'My own task', assignee: priyaId, estimateSeconds: 3600 });
ok('team member can add a task', mine.status === 201, mine.status);
ok('it is always assigned to herself (cannot assign others)', mine.data.assignee?.name === 'Lena Fischer', JSON.stringify(mine.data.assignee));
ok('she can edit her own task', (await call(lenaT, 'PATCH', `/tasks/${mine.data.id}`, { title: 'My own task (renamed)', priority: 'high' })).status === 200);
ok('she cannot reassign it', (await call(lenaT, 'PATCH', `/tasks/${mine.data.id}`, { assignee: priyaId })).status === 403);
ok('she cannot edit a task someone else owns', (await call(lenaT, 'PATCH', `/tasks/${login_.id}`, { title: 'x' })).status === 403);
ok('viewer cannot add tasks', (await call(devT, 'POST', '/tasks', { project: webId, title: 'nope' })).status === 403);
ok('she can delete her own task (no time tracked)', (await call(lenaT, 'DELETE', `/tasks/${mine.data.id}`)).status === 200);
const notMember = await call(lenaT, 'POST', '/tasks', { project: tools.id, title: 'sneaky' });
ok('adding to a project she is not on is blocked', [403, 404].includes(notMember.status), notMember.status);

console.log('Visibility: employees see only their own work');
const wid = login_.project.id;
const lenaTasks = (await call(lenaT, 'GET', '/tasks?project=' + wid)).data.map((t) => t.title);
ok('employee sees her own tasks', lenaTasks.includes('Homepage hero section') && lenaTasks.includes('Brand style guide'), lenaTasks.join('|'));
ok('employee does NOT see teammate tasks', !lenaTasks.includes('Content migration') && !lenaTasks.includes('SEO audit & fixes'), lenaTasks.join('|'));
ok('employee sees only her subtask under another person task', lenaTasks.includes('Design the login screen') && !lenaTasks.includes('Integrate the authentication API'), lenaTasks.join('|'));
const migrate = allWeb.find((x) => x.title === 'Content migration');
ok('opening a teammate task by id is blocked (404)', (await call(lenaT, 'GET', `/tasks/${migrate.id}`)).status === 404);
ok('cannot start a timer on a teammate task', (await call(lenaT, 'POST', '/timer/start', { taskId: migrate.id })).status === 404);
ok('cannot log time on a teammate task', (await call(lenaT, 'POST', '/time-entries', { taskId: migrate.id, workDate: new Date().toLocaleDateString('en-CA'), durationSeconds: 600 })).status === 404);
ok('search does not leak teammate tasks', (await call(lenaT, 'GET', '/tasks?q=Content')).data.length === 0);
const lp = (await call(lenaT, 'GET', '/projects/' + wid)).data;
ok('team hours of others are hidden from employees', Object.keys(lp.timeByUser).length <= 1 && Object.keys(lp.openByUser).length <= 1, JSON.stringify(lp.timeByUser));
const countFor = (tok) => call(tok, 'GET', '/tasks?project=' + wid).then((r) => r.data.length);
const total = await countFor(rajT);
ok('project manager sees every task', total === 10, total);
ok('owner sees every task', (await countFor(oliviaT)) === total);
ok('read-only viewer sees every task', (await countFor(devT)) === total);
ok('parent-task owner sees all its subtasks', (await call(priyaT, 'GET', `/tasks/${login_.id}`)).data.subtasks.length === 4);
const detail = (await call(lenaT, 'GET', `/tasks/${login_.id}`)).data;
ok('subtask-only assignee sees only her subtask in the parent', detail.subtasks.length === 1 && detail.subtasks[0].title === 'Design the login screen', detail.subtasks.map((x) => x.title).join('|'));
ok('...and only her own time entries', detail.entries.every((e) => e.user.name === 'Lena Fischer'));

console.log('Sign-up with admin approval');
const em = `newbie${Date.now()}@example.com`;
ok('sign-up is advertised as enabled', (await call(null, 'GET', '/auth/config')).data.signup === true);
ok('short password rejected', (await call(null, 'POST', '/auth/signup', { name: 'New Person', email: em, password: 'short' })).status === 400);
ok('invalid email rejected', (await call(null, 'POST', '/auth/signup', { name: 'New Person', email: 'not-an-email', password: 'longenough1' })).status === 400);
const su = await call(null, 'POST', '/auth/signup', { name: 'New Person', email: em, password: 'longenough1' });
ok('sign-up creates a pending request', su.status === 201 && su.data.pending === true, JSON.stringify(su.data));
ok('duplicate email rejected', (await call(null, 'POST', '/auth/signup', { name: 'Again', email: em, password: 'longenough1' })).status === 400);
const pend = await call(null, 'POST', '/auth/login', { email: em, password: 'longenough1' });
ok('pending user cannot sign in yet (403)', pend.status === 403 && /approval/i.test(pend.data.error), JSON.stringify(pend.data));
ok('wrong password still looks like a normal failure', (await call(null, 'POST', '/auth/login', { email: em, password: 'wrong-password' })).status === 400);
const ownerUsers = (await call(oliviaT, 'GET', '/users')).data;
const pendingUser = ownerUsers.find((u) => u.email === em);
ok('owner sees the pending request', pendingUser?.pending === true);
ok('employees do not see pending people in the directory', !(await call(priyaT, 'GET', '/users')).data.some((u) => u.email === em));
ok('employee cannot approve', (await call(priyaT, 'POST', `/users/${pendingUser.id}/approve`, {})).status === 403);
ok('manager cannot approve', (await call(rajT, 'POST', `/users/${pendingUser.id}/approve`, {})).status === 403);
ok('owner approves as employee', (await call(oliviaT, 'POST', `/users/${pendingUser.id}/approve`, { role: 'employee' })).data.role === 'employee');
const nowIn = await call(null, 'POST', '/auth/login', { email: em, password: 'longenough1' });
ok('approved user can sign in', nowIn.status === 200 && !!nowIn.data.token);
ok('...and starts with no projects', (await call(nowIn.data.token, 'GET', '/projects')).data.length === 0);
const em2 = `decline${Date.now()}@example.com`;
await call(null, 'POST', '/auth/signup', { name: 'To Decline', email: em2, password: 'longenough1' });
const p2 = (await call(oliviaT, 'GET', '/users')).data.find((u) => u.email === em2);
ok('owner declines a request', (await call(oliviaT, 'POST', `/users/${p2.id}/reject`)).status === 200);
ok('declined user cannot sign in', (await call(null, 'POST', '/auth/login', { email: em2, password: 'longenough1' })).status === 400);
ok('cannot "decline" an active user', (await call(oliviaT, 'POST', `/users/${pendingUser.id}/reject`)).status === 404);

console.log('Timer pause / resume keeps time');
await call(lenaT, 'POST', '/timer/stop', {});
const lt = (await call(lenaT, 'GET', '/tasks?mine=1&status=todo,in_progress,blocked,in_review')).data.filter((x) => x.assignee?.name === 'Lena Fischer');
const [tA, tB] = lt;
await call(lenaT, 'POST', '/timer/start', { taskId: tA.id });
await new Promise((r) => setTimeout(r, 2200));
await call(lenaT, 'POST', '/timer/start', { taskId: tB.id }); // auto-pauses A after ~2s
const afterPause = (await call(lenaT, 'GET', '/timer')).data.sessions.find((x) => x.task.id === tA.id);
ok('paused timer banked ~2s', afterPause.state === 'paused' && afterPause.accumulatedSeconds >= 2, afterPause.accumulatedSeconds);
await new Promise((r) => setTimeout(r, 1200));
await call(lenaT, 'POST', '/timer/start', { taskId: tA.id }); // resume A
const resumed = (await call(lenaT, 'GET', '/timer')).data.sessions.find((x) => x.task.id === tA.id);
ok('resuming continues from the banked time (does not restart at 0)', resumed.state === 'running' && resumed.accumulatedSeconds >= afterPause.accumulatedSeconds, `${resumed.accumulatedSeconds} vs ${afterPause.accumulatedSeconds}`);
const stopA = (await call(lenaT, 'POST', '/timer/stop', { taskId: tA.id })).data.entry;
ok('stop saves the FULL time (before + after the pause) as one entry', stopA && stopA.durationSeconds >= 2, stopA?.durationSeconds);
await call(lenaT, 'POST', '/timer/stop', {});

console.log('Only the assigned person can track time');
const T = (await call(rajT, 'GET', '/tasks?project=' + wid)).data;
const pTask = T.find((x) => x.title === 'Content migration');       // assigned to Priya
const loginT = T.find((x) => x.title.startsWith('Develop the employee')); // Priya, collaborator Sam
const cookie = T.find((x) => x.title === 'Cookie consent banner');  // unassigned
ok('manager cannot start a timer on someone else\'s task', (await call(rajT, 'POST', '/timer/start', { taskId: pTask.id })).status === 403);
ok('owner/admin cannot start a timer on someone else\'s task', (await call(oliviaT, 'POST', '/timer/start', { taskId: pTask.id })).status === 403);
ok('collaborator cannot start a timer (only the assignee)', (await call(samT, 'POST', '/timer/start', { taskId: loginT.id })).status === 403);
ok('nobody can start a timer on an unassigned task', (await call(oliviaT, 'POST', '/timer/start', { taskId: cookie.id })).status === 400);
ok('manager cannot log manual time on someone else\'s task', (await call(rajT, 'POST', '/time-entries', { taskId: pTask.id, workDate: new Date().toLocaleDateString('en-CA'), durationSeconds: 600 })).status === 403);
ok('the assignee CAN start the timer', (await call(priyaT, 'POST', '/timer/start', { taskId: pTask.id })).status === 200);
// reassigning closes the previous assignee's timer and keeps the time as an entry
const sam = (await call(oliviaT, 'GET', '/users')).data.find((u) => u.name === 'Sam Carter');
await new Promise((r) => setTimeout(r, 1500));
const re = await call(rajT, 'PATCH', `/tasks/${pTask.id}`, { assignee: sam.id });
ok('manager can reassign the task', re.status === 200 && re.data.assignee.name === 'Sam Carter', JSON.stringify(re.data));
ok('previous assignee timer was closed on reassignment', (await call(priyaT, 'GET', '/timer')).data.sessions.every((x) => x.task.id !== pTask.id));
const kept = (await call(priyaT, 'GET', '/time-entries?mine=1')).data.entries.some((e) => e.task.id === pTask.id && e.source === 'timer');
ok('...and her tracked time was saved, not lost', kept);
ok('new assignee can now start it', (await call(samT, 'POST', '/timer/start', { taskId: pTask.id })).status === 200);
await call(samT, 'POST', '/timer/stop', {});

console.log('Task estimate = total of its subtasks (automatic)');
const H = 3600;
const taskDetail = async (id) => (await call(rajT, 'GET', `/tasks/${id}`)).data;
const parentEst = async () => (await taskDetail(login_.id)).task.estimateSeconds;
const d0 = await taskDetail(login_.id);
const P0 = d0.task.estimateSeconds;
const U0 = d0.subtasks.filter((x) => x.status !== 'cancelled').reduce((acc, x) => acc + (x.estimateSeconds || 0), 0);
ok('parent estimate equals the sum of its subtask estimates', P0 === U0 && P0 > 0, `${P0} vs ${U0}`);
ok('task detail says the estimate is derived from subtasks', d0.estimateDerived === true);
const added = await call(rajT, 'POST', '/tasks', { parent: login_.id, title: 'New subtask with 2 h', estimateSeconds: 2 * H });
ok('adding a subtask with 2 h raises the parent estimate by 2 h', added.status === 201 && (await parentEst()) === P0 + 2 * H, `${await parentEst()} vs ${P0 + 2 * H}`);
ok('re-estimating that subtask to 5 h updates the parent', (await call(rajT, 'PATCH', `/tasks/${added.data.id}`, { estimateSeconds: 5 * H })).status === 200 && (await parentEst()) === P0 + 5 * H);
ok('cancelling the subtask removes its hours from the parent', (await call(rajT, 'PATCH', `/tasks/${added.data.id}`, { status: 'cancelled' })).status === 200 && (await parentEst()) === P0);
ok('reopening it adds them back', (await call(rajT, 'PATCH', `/tasks/${added.data.id}`, { status: 'todo' })).status === 200 && (await parentEst()) === P0 + 5 * H);
ok('deleting it removes its hours', (await call(rajT, 'DELETE', `/tasks/${added.data.id}`)).status === 200 && (await parentEst()) === P0);
const noEst = await call(rajT, 'POST', '/tasks', { parent: login_.id, title: 'Subtask without hours' });
ok('a subtask without hours leaves the parent estimate unchanged', noEst.status === 201 && (await parentEst()) === P0);
ok('giving it hours later raises the parent estimate', (await call(rajT, 'PATCH', `/tasks/${noEst.data.id}`, { estimateSeconds: H })).status === 200 && (await parentEst()) === P0 + H);
await call(rajT, 'DELETE', `/tasks/${noEst.data.id}`);
const manual = await call(rajT, 'PATCH', `/tasks/${login_.id}`, { estimateSeconds: P0 + 10 * H });
ok('the parent estimate cannot be edited directly (it is the sum of its subtasks)', manual.status === 400 && /total of its subtasks/i.test(manual.data.error), JSON.stringify(manual.data));
ok('...also not by the assignee', (await call(priyaT, 'PATCH', `/tasks/${login_.id}`, { estimateSeconds: P0 + 10 * H })).status === 400);
ok('...and nobody is offered an estimate edit on it', (await taskDetail(login_.id)).canEstimate === false);
const plain = (await call(rajT, 'GET', '/tasks?project=' + wid)).data.find((x) => x.title === 'Cookie consent banner'); // no subtasks, no estimate
ok('a task without subtasks keeps a manual estimate', (await call(rajT, 'PATCH', `/tasks/${plain.id}`, { estimateSeconds: 3 * H })).status === 200);
const kid = await call(rajT, 'POST', '/tasks', { parent: plain.id, title: 'First subtask', estimateSeconds: 5 * H });
ok('its first estimated subtask takes over the estimate (5 h)', kid.status === 201 && (await taskDetail(plain.id)).task.estimateSeconds === 5 * H);
const kid2 = await call(rajT, 'POST', '/tasks', { parent: plain.id, title: 'Second subtask', estimateSeconds: 2 * H });
ok('a second subtask adds to it (7 h)', (await taskDetail(plain.id)).task.estimateSeconds === 7 * H);
ok('subtask hours still show in the activity log of the parent', (await taskDetail(plain.id)).activity.some((x) => /total of subtasks/i.test(x.summary)));
console.log('Timer locks when the estimate is fully used');
const today2 = new Date().toLocaleDateString('en-CA');
const budgetTask = (await call(rajT, 'POST', '/tasks', { project: wid, title: 'Budget test', assignee: sam.id, estimateSeconds: 3600 })).data;
ok('under budget: assignee can start', (await call(samT, 'POST', '/timer/start', { taskId: budgetTask.id })).status === 200);
await call(samT, 'POST', '/timer/stop', {});
await call(samT, 'POST', '/time-entries', { taskId: budgetTask.id, workDate: today2, durationSeconds: 3600, description: 'uses the whole estimate' });
const locked = await call(samT, 'POST', '/timer/start', { taskId: budgetTask.id });
ok('estimate fully used: timer start is refused (409 ESTIMATE_USED)', locked.status === 409 && locked.data.code === 'ESTIMATE_USED', JSON.stringify(locked.data));
ok('the task shows its saved totals as exhausted', (await call(samT, 'GET', `/tasks/${budgetTask.id}`)).data.task.totals.total === 3600);
ok('manager raises the estimate', (await call(rajT, 'PATCH', `/tasks/${budgetTask.id}`, { estimateSeconds: 7200 })).status === 200);
ok('a plain team member (not manager/lead) who is the assignee can raise the estimate of his task', (await call(samT, 'PATCH', `/tasks/${budgetTask.id}`, { estimateSeconds: 9000 })).status === 200);
ok('...but cannot change other fields (title)', (await call(samT, 'PATCH', `/tasks/${budgetTask.id}`, { title: 'renamed' })).status === 403);
ok('...nor reassign it', (await call(samT, 'PATCH', `/tasks/${budgetTask.id}`, { assignee: priyaId })).status === 403);
ok('a collaborator or other member cannot change the estimate', (await call(lenaT, 'PATCH', `/tasks/${budgetTask.id}`, { estimateSeconds: 99999 })).status === 404);
ok('an assignee cannot set a negative estimate', (await call(samT, 'PATCH', `/tasks/${budgetTask.id}`, { estimateSeconds: -5 })).status === 400);
ok('task detail tells the assignee he can edit the estimate', (await call(samT, 'GET', `/tasks/${budgetTask.id}`)).data.canEstimate === true);
ok('after the estimate is increased, the timer can start again', (await call(samT, 'POST', '/timer/start', { taskId: budgetTask.id })).status === 200);
await call(samT, 'POST', '/timer/stop', {});
const nearTask = (await call(rajT, 'POST', '/tasks', { project: wid, title: 'Almost used test', assignee: priyaId, estimateSeconds: 7200 })).data;
await call(priyaT, 'POST', '/time-entries', { taskId: nearTask.id, workDate: today2, durationSeconds: 7180 }); // 20 s left, like "<1 m remaining"
const near = await call(priyaT, 'POST', '/timer/start', { taskId: nearTask.id });
ok('less than a minute left counts as fully used (the "<1 m remaining" case)', near.status === 409 && near.data.code === 'ESTIMATE_USED', JSON.stringify(near.data));
const plenty = (await call(rajT, 'POST', '/tasks', { project: wid, title: 'Plenty left test', assignee: priyaId, estimateSeconds: 7200 })).data;
await call(priyaT, 'POST', '/time-entries', { taskId: plenty.id, workDate: today2, durationSeconds: 7080 }); // 2 min left
ok('with 2 minutes left the timer still starts', (await call(priyaT, 'POST', '/timer/start', { taskId: plenty.id })).status === 200);
await call(priyaT, 'POST', '/timer/stop', {});
const zeroTask = (await call(rajT, 'POST', '/tasks', { project: wid, title: 'Zero estimate test', assignee: priyaId, estimateSeconds: 0 })).data;
ok('an explicit 0 h estimate does not block tracking', (await call(priyaT, 'POST', '/timer/start', { taskId: zeroTask.id })).status === 200);
await call(priyaT, 'POST', '/timer/stop', {});
const noEstTask = (await call(rajT, 'POST', '/tasks', { project: wid, title: 'No estimate test', assignee: priyaId })).data;
await call(priyaT, 'POST', '/time-entries', { taskId: noEstTask.id, workDate: today2, durationSeconds: 36000 });
ok('a task with no estimate is never locked', (await call(priyaT, 'POST', '/timer/start', { taskId: noEstTask.id })).status === 200);
await call(priyaT, 'POST', '/timer/stop', {});

console.log('Starter subtask on every new task');
const STARTER = 'Review or understand requirement';
const fresh = await call(rajT, 'POST', '/tasks', { project: wid, title: 'Starter subtask test', assignee: priyaId, priority: 'high', estimateSeconds: 4 * 3600, deadline: '2030-01-15' });
const fd = (await call(rajT, 'GET', `/tasks/${fresh.data.id}`)).data;
ok('a new task gets exactly one starter subtask', fd.subtasks.length === 1 && fd.subtasks[0].title === STARTER, JSON.stringify(fd.subtasks.map((x) => x.title)));
ok('the starter subtask belongs to the same project and parent', fd.subtasks[0].project.id === wid && fd.subtasks[0].parent === fresh.data.id);
ok('it is assigned to the same person and copies priority and deadline', fd.subtasks[0].assignee?.id === priyaId && fd.subtasks[0].priority === 'high' && String(fd.subtasks[0].deadline).startsWith('2030-01-15'));
ok('it starts as To Do and is required', fd.subtasks[0].status === 'todo' && fd.subtasks[0].required === true);
ok('it has no estimate, so the task estimate is unchanged (4 h)', fd.subtasks[0].estimateSeconds == null && fd.task.estimateSeconds === 4 * 3600);
ok('the assignee can track time on it', (await call(priyaT, 'POST', '/timer/start', { taskId: fd.subtasks[0].id })).status === 200);
await call(priyaT, 'POST', '/timer/stop', {});
const nested = await call(rajT, 'POST', '/tasks', { parent: fresh.data.id, title: 'A normal subtask' });
ok('creating a subtask does NOT create another starter subtask', nested.status === 201 && (await call(rajT, 'GET', `/tasks/${fresh.data.id}`)).data.subtasks.length === 2);
const selfTask = await call(lenaT, 'POST', '/tasks', { project: wid, title: 'Lena own task for starter test' });
const sd = (await call(lenaT, 'GET', `/tasks/${selfTask.data.id}`)).data;
ok('a task a member adds for herself also gets the starter subtask, assigned to her', sd.subtasks.length === 1 && sd.subtasks[0].title === STARTER && sd.subtasks[0].assignee?.name === 'Lena Fischer');
ok('the starter subtask is a normal subtask: it can be deleted while it has no time', (await call(lenaT, 'DELETE', `/tasks/${sd.subtasks[0].id}`)).status === 200);
ok('required starter subtask blocks completing the task until done (or manager override)', (await call(rajT, 'PATCH', `/tasks/${fresh.data.id}`, { status: 'completed' })).status === 409);

console.log('Scenario: 1 h subtask is used up, then 15 m is added');
const sc = (await call(rajT, 'POST', '/tasks', { project: wid, title: 'Create website', assignee: sam.id })).data;
const scSub = (await call(rajT, 'GET', `/tasks/${sc.id}`)).data.subtasks[0]; // starter subtask
await call(rajT, 'PATCH', `/tasks/${scSub.id}`, { estimateSeconds: 3600 });
ok('subtask estimate 1 h makes the parent estimate 1 h', (await call(rajT, 'GET', `/tasks/${sc.id}`)).data.task.estimateSeconds === 3600);
await call(samT, 'POST', '/time-entries', { taskId: scSub.id, workDate: new Date().toLocaleDateString('en-CA'), durationSeconds: 3600 });
ok('after the 1 h is used, the subtask timer is locked', (await call(samT, 'POST', '/timer/start', { taskId: scSub.id })).status === 409);
const only15 = await call(samT, 'PATCH', `/tasks/${scSub.id}`, { estimateSeconds: 900 });
ok('typing only 15 min SETS the estimate to 15 m (below the 1 h used), so it stays locked', only15.status === 200 && (await call(samT, 'POST', '/timer/start', { taskId: scSub.id })).status === 409);
ok('setting 1 h 15 m (1 h + 15 m) makes the parent estimate 1 h 15 m', (await call(samT, 'PATCH', `/tasks/${scSub.id}`, { estimateSeconds: 4500 })).status === 200 && (await call(rajT, 'GET', `/tasks/${sc.id}`)).data.task.estimateSeconds === 4500);
ok('...and the subtask timer works again', (await call(samT, 'POST', '/timer/start', { taskId: scSub.id })).status === 200);
await call(samT, 'POST', '/timer/stop', {});

console.log('Parent with subtasks: only SUBTASK time counts against its estimate');
const today3 = new Date().toLocaleDateString('en-CA');
const pt = (await call(rajT, 'POST', '/tasks', { project: wid, title: 'Parent usage test', assignee: sam.id })).data;
const ps = (await call(rajT, 'GET', `/tasks/${pt.id}`)).data.subtasks[0];
await call(rajT, 'PATCH', `/tasks/${ps.id}`, { estimateSeconds: 3600 }); // parent estimate becomes 1 h (derived)
await call(samT, 'POST', '/time-entries', { taskId: pt.id, workDate: today3, durationSeconds: 5 * 3600 }); // 5 h tracked DIRECTLY on the parent
const ptd = (await call(rajT, 'GET', `/tasks/${pt.id}`)).data.task;
ok('totals mark the parent as derived and report subtask-only usage', ptd.totals.derived === true && ptd.totals.used === 0 && ptd.totals.direct === 5 * 3600, JSON.stringify(ptd.totals));
ok('5 h of direct parent time does NOT lock the parent timer (estimate comes from subtasks)', (await call(samT, 'POST', '/timer/start', { taskId: pt.id })).status === 200);
await call(samT, 'POST', '/timer/stop', {});
await call(samT, 'POST', '/time-entries', { taskId: ps.id, workDate: today3, durationSeconds: 3600 }); // the subtask hour is used up
ok('once the subtasks\' hours are used up, the parent timer is locked', (await call(samT, 'POST', '/timer/start', { taskId: pt.id })).status === 409);
ok('raising the subtask estimate (by +15 m) updates the parent estimate', (await call(samT, 'PATCH', `/tasks/${ps.id}`, { estimateSeconds: 4500 })).status === 200 && (await call(rajT, 'GET', `/tasks/${pt.id}`)).data.task.estimateSeconds === 4500);
ok('...and the parent timer can be started again', (await call(samT, 'POST', '/timer/start', { taskId: pt.id })).status === 200);
await call(samT, 'POST', '/timer/stop', {});

console.log('Raising the estimate of COMPLETED work reopens it');
const today4 = new Date().toLocaleDateString('en-CA');
const rt = (await call(rajT, 'POST', '/tasks', { project: wid, title: 'Reopen test', assignee: sam.id })).data;
const rs = (await call(rajT, 'GET', `/tasks/${rt.id}`)).data.subtasks[0];
await call(rajT, 'PATCH', `/tasks/${rs.id}`, { estimateSeconds: 3600 });
await call(samT, 'POST', '/time-entries', { taskId: rs.id, workDate: today4, durationSeconds: 3600 });
await call(samT, 'PATCH', `/tasks/${rs.id}`, { status: 'completed' });
ok('a completed subtask cannot be timed', (await call(samT, 'POST', '/timer/start', { taskId: rs.id })).status === 400);
const lower = await call(samT, 'PATCH', `/tasks/${rs.id}`, { estimateSeconds: 1800 });
ok('lowering the estimate does not reopen it', lower.status === 200 && lower.data.status === 'completed');
const stillFull = await call(samT, 'PATCH', `/tasks/${rs.id}`, { estimateSeconds: 3500 });
ok('raising it but still below the time already used does not reopen it', stillFull.data.status === 'completed');
const raised = await call(samT, 'PATCH', `/tasks/${rs.id}`, { estimateSeconds: 9900 }); // 2 h 45 m
ok('raising it to 2 h 45 m (room left) reopens the task as In Progress', raised.status === 200 && raised.data.status === 'in_progress' && !raised.data.completedAt, JSON.stringify({ s: raised.data.status }));
ok('...and the timer can be started', (await call(samT, 'POST', '/timer/start', { taskId: rs.id })).status === 200);
await call(samT, 'POST', '/timer/stop', {});
ok('the reopening is recorded in the activity log', (await call(samT, 'GET', `/tasks/${rs.id}`)).data.activity.some((x) => /reopened because the estimate was increased/i.test(x.summary)));
ok('cancelled work is never auto-reopened', (await call(rajT, 'PATCH', `/tasks/${rs.id}`, { status: 'cancelled' })).status === 200 && (await call(samT, 'PATCH', `/tasks/${rs.id}`, { estimateSeconds: 20000 })).data.status === 'cancelled');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
