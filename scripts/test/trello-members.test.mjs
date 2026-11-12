// Trello members without a Chronos account become PENDING users. Run on a throwaway DB seeded WITHOUT a user named like the Trello member.
//   API=http://localhost:3001/api node scripts/test/trello-members.test.mjs
import 'dotenv/config';

const API = process.env.API || 'http://localhost:3001/api';
const BOARD = process.env.TEST_TRELLO_BOARD || 'ece0EeVz';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}${cond ? '' : ' ' + extra}`); };
async function call(token, method, path, body) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const login = async (email, password = 'Password@123') => (await call(null, 'POST', '/auth/login', { email, password })).data?.token;

const owner = await login('olivia@acme.test');
const trelloAuth = { Authorization: `OAuth oauth_consumer_key="${process.env.TRELLO_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"` };
const members = await (await fetch(`https://api.trello.com/1/boards/${BOARD}/members?fields=fullName,username`, { headers: trelloAuth })).json();
const N = members.length; // every board member is unknown to the freshly seeded DB
const imp = await call(owner, 'POST', '/trello/import', { board: BOARD });
ok('board imported', imp.status === 201, JSON.stringify(imp.data));
const pid = imp.data.id;
ok('the sync reports the new access request', imp.data.result.pendingUsers === N, JSON.stringify(imp.data.result));

let users = (await call(owner, 'GET', '/users')).data;
const pend = users.find((u) => u.pending && u.email.endsWith('@trello.invalid') && u.name === 'rusha');
ok('a pending user was created for the Trello member', !!pend && pend.active === false, JSON.stringify(users.filter((u) => u.pending)));
const tasks = (await call(owner, 'GET', `/tasks?project=${pid}`)).data.filter((t) => !t.parent);
ok('their cards stay unassigned until approval', tasks.every((t) => !t.assignee));
// cards assigned only to unapproved members are for the admin's eyes only
const withMembers = (await (await fetch(`https://api.trello.com/1/boards/${BOARD}/cards/open?fields=idMembers`, { headers: trelloAuth })).json()).filter((c) => c.idMembers.length).length;
const raj = await login('raj@acme.test');
const rajUser = (await call(owner, 'GET', '/users')).data.find((u) => u.email === 'raj@acme.test');
await call(owner, 'PATCH', `/projects/${pid}`, { manager: rajUser.id });
const seenByRaj = (await call(raj, 'GET', `/tasks?project=${pid}`)).data.filter((t) => !t.parent);
const seenByOwner = (await call(owner, 'GET', `/tasks?project=${pid}`)).data.filter((t) => !t.parent);
ok('the admin sees every card', seenByOwner.length === tasks.length && withMembers > 0, `${seenByOwner.length}/${tasks.length}`);
ok('a project manager does not see cards held for unapproved members', seenByRaj.length === tasks.length - withMembers, `${seenByRaj.length} vs ${tasks.length - withMembers}`);
const hiddenId = seenByOwner.find((t) => !seenByRaj.some((x) => x.id === t.id))?.id;
ok('...and cannot open one directly', (await call(raj, 'GET', `/tasks/${hiddenId}`)).status === 404 && (await call(owner, 'GET', `/tasks/${hiddenId}`)).status === 200);
ok('the admin gets a "waiting for approval" note on cards with unapproved members', seenByOwner.filter((t) => t.waiting?.length).length === withMembers, JSON.stringify(seenByOwner.map((t) => t.waiting)));
const detail = (await call(owner, 'GET', `/tasks/${hiddenId}`)).data;
ok('...also in the task details', detail.task.waiting?.length > 0, JSON.stringify(detail.task.waiting));
ok('nobody else gets the note', !(await call(raj, 'GET', `/tasks?project=${pid}`)).data.some((t) => t.waiting));
ok('the placeholder cannot sign in', (await call(null, 'POST', '/auth/login', { email: pend.email, password: 'whatever123' })).status >= 400);

const again = await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
users = (await call(owner, 'GET', '/users')).data;
ok('syncing again does not create a duplicate', users.filter((u) => u.pending && u.email.endsWith('@trello.invalid')).length === N && again.data.result.pendingUsers === 0, JSON.stringify(again.data));

const notes = (await call(owner, 'GET', '/notifications')).data;
ok('the admin was notified', JSON.stringify(notes).includes('need'), JSON.stringify(notes).slice(0, 200));

ok('approval without an email is refused', (await call(owner, 'POST', `/users/${pend.id}/approve`, { role: 'employee' })).status === 400);
ok('approval with a weak password is refused', (await call(owner, 'POST', `/users/${pend.id}/approve`, { role: 'employee', email: 'rusha.real@acme.test', password: 'short' })).status === 400);
ok('approval with an email already in use is refused', (await call(owner, 'POST', `/users/${pend.id}/approve`, { role: 'employee', email: 'priya@acme.test', password: 'longenough1' })).status === 400);
const appr = await call(owner, 'POST', `/users/${pend.id}/approve`, { role: 'employee', email: 'rusha.real@acme.test', password: 'longenough1' });
ok('approval with real email + password works', appr.status === 200, JSON.stringify(appr.data));
ok('they can now sign in', !!(await login('rusha.real@acme.test', 'longenough1')));

const sync = await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
const after = (await call(owner, 'GET', `/tasks?project=${pid}`)).data.filter((t) => !t.parent);
const proj = (await call(owner, 'GET', `/projects/${pid}`)).data;
ok('after approval the held cards are visible to the project manager again', (await call(raj, 'GET', `/tasks?project=${pid}`)).data.filter((t) => !t.parent).length >= seenByRaj.length + 1);
ok('the approved person is matched and cards get their assignee', sync.status === 200 && proj.trello.memberMap.length === 1 && after.some((t) => t.assignee), JSON.stringify(proj.trello.memberMap));

// a second member who is approved LATER joins cards that were imported without them
const other = members.find((m) => m.username !== 'rusha');
await call(owner, 'POST', '/users', { name: other.fullName, email: `late${Date.now()}@acme.test`, password: 'longenough1', role: 'employee' });
await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
const cardsT = await (await fetch(`https://api.trello.com/1/boards/${BOARD}/cards/open?fields=idMembers`, { headers: trelloAuth })).json();
const now = (await call(owner, 'GET', `/tasks?project=${pid}`)).data.filter((t) => !t.parent && t.trello?.cardId);
const bad = cardsT.filter((c) => { const t = now.find((x) => x.trello.cardId === c.id); const n = (t?.assignee ? 1 : 0) + (t?.collaborators?.length || 0); return c.idMembers.filter((id) => members.some((m) => m.id === id && (m.username === 'rusha' || m.id === other.id))).length !== n; });
ok('every Trello card member who now has an account is on the card in Chronos', bad.length === 0, JSON.stringify(bad));

// sign-up by name claims a Trello placeholder instead of duplicating it (a second pending user needs a second unmatched member, so check the no-match path stays normal)
const su = await call(null, 'POST', '/auth/signup', { name: 'Someone Else', email: 'someone.else@acme.test', password: 'longenough1' });
ok('normal sign-up still works', su.status === 201);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
