// End-to-end check of the Trello sync against a REAL Trello board (use a throwaway board!).
// Run with the app started on a throwaway database:  API=http://localhost:3001/api node scripts/test/trello.test.mjs
// It only modifies cards that this script creates itself, and deletes them again at the end.
import 'dotenv/config';

const API = process.env.API || 'http://localhost:3000/api';
const BOARD = process.env.TEST_TRELLO_BOARD || 'ece0EeVz';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}${cond ? '' : ' ' + extra}`); };

async function call(token, method, path, body) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
// direct Trello access (to prove what really happened on Trello's side)
const T = async (method, path, params = {}, body) => {
  const url = new URL('https://api.trello.com/1' + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { method, headers: { Authorization: `OAuth oauth_consumer_key="${process.env.TRELLO_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`Trello ${method} ${path} -> ${r.status} ${t.slice(0, 100)}`);
  return t ? JSON.parse(t) : null;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (email) => (await call(null, 'POST', '/auth/login', { email, password: 'Password@123' })).data.token;
const owner = await login('olivia@acme.test');
const createdCards = [];

// snapshot of the cards that existed BEFORE the test: they must be untouched afterwards
const before = (await T('GET', `/boards/${BOARD}/cards/all`, { fields: 'name,desc,idList,closed,due,idLabels,idMembers' })).map((c) => JSON.stringify(c)).sort();

try {
  console.log('Connection');
  const st = await call(owner, 'GET', '/trello/status');
  ok('Trello is configured and the account is recognised', st.data.configured === true && !!st.data.account?.username, JSON.stringify(st.data));
  const boards = await call(owner, 'GET', '/trello/boards');
  ok('the board picker lists the test board', boards.data.some((b) => b.shortLink === BOARD), JSON.stringify(boards.data.map((b) => b.shortLink)));
  ok('employees cannot browse boards or import', (await call(await login('priya@acme.test'), 'GET', '/trello/boards')).status === 403);

  console.log('Import');
  const tb = await T('GET', `/boards/${BOARD}`, { lists: 'open', list_fields: 'name', labels: 'all', label_fields: 'name,color', label_limit: 1000, members: 'all', member_fields: 'fullName,username' });
  const openCards = await T('GET', `/boards/${BOARD}/cards/open`, { fields: 'name,idList,idMembers', checklists: 'all' });
  const items = openCards.reduce((s, c) => s + c.checklists.reduce((a, cl) => a + cl.checkItems.length, 0), 0);
  // a Chronos user that matches the Trello member by name, so assignments can be tested
  const rushaTrello = tb.members.find((m) => m.username === 'rusha') || tb.members[0];
  const mk = await call(owner, 'POST', '/users', { name: rushaTrello.fullName, email: `trellomember${Date.now()}@example.com`, password: 'longenough1', role: 'employee' });
  ok('a Chronos user matching the Trello member exists', mk.status === 201, JSON.stringify(mk.data));
  const imp = await call(owner, 'POST', '/trello/import', { board: `https://trello.com/b/${BOARD}/whatever-name` });
  ok('importing the board by URL works', imp.status === 201, JSON.stringify(imp.data));
  const pid = imp.data.id;
  ok('every open card became a task', imp.data.result.created === openCards.length, `${imp.data.result.created} vs ${openCards.length}`);
  ok('every checklist item became a subtask', imp.data.result.subtasks === items, `${imp.data.result.subtasks} vs ${items}`);
  const proj = (await call(owner, 'GET', `/projects/${pid}`)).data;
  ok('the project keeps the board lists as stages', proj.trello.lists.length === tb.lists.length && proj.trello.lists.every((l, i) => tb.lists.some((x) => x.id === l.id)));
  ok('the project keeps all board labels', proj.trello.labels.length === tb.labels.length, `${proj.trello.labels.length} vs ${tb.labels.length}`);
  const all = (await call(owner, 'GET', `/tasks?project=${pid}`)).data;
  const tops = all.filter((t) => !t.parent);
  ok('tasks carry their Trello list as stage', tops.length === openCards.length && tops.every((t) => t.stage && t.trello?.cardId));
  ok('imported cards did not get the automatic starter subtask', !all.some((t) => t.title === 'Review or understand requirement'));
  const withMember = openCards.find((c) => c.idMembers.length);
  if (withMember) ok('a card member is matched to the Chronos user (assignee)', tops.find((t) => t.trello.cardId === withMember.id)?.assignee?.name === rushaTrello.fullName);
  ok('importing the same board twice is refused', (await call(owner, 'POST', '/trello/import', { board: BOARD })).status === 400);
  const again = await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
  ok('syncing again changes nothing (idempotent)', again.status === 200 && again.data.result.created === 0 && again.data.result.updated === 0 && again.data.result.subtasks === 0, JSON.stringify(again.data));

  console.log('Chronos -> Trello');
  const listBy = (name) => proj.trello.lists.find((l) => l.name === name) || proj.trello.lists[0];
  const lToday = listBy('Today'), lWeek = listBy('This Week'), lLater = listBy('Later');
  const green = proj.trello.labels.find((l) => l.color === 'green'), blue = proj.trello.labels.find((l) => l.color === 'blue');
  const made = await call(owner, 'POST', '/tasks', { project: pid, title: 'Chronos sync test card', description: 'created by the sync test', deadline: '2030-05-01', stageId: lToday.id, labelIds: [green.id] });
  ok('a task created in Chronos is created', made.status === 201, JSON.stringify(made.data));
  const tid = made.data.id;
  const cardId = (await call(owner, 'GET', `/tasks/${tid}`)).data.task.trello?.cardId;
  ok('...and gets a Trello card', !!cardId);
  if (cardId) createdCards.push(cardId);
  let card = await T('GET', `/cards/${cardId}`, { fields: 'name,desc,due,idList,idLabels,closed,dueComplete,idMembers' });
  ok('the card has the same title, description, due date, list and label', card.name === 'Chronos sync test card' && card.desc === 'created by the sync test' && card.due?.startsWith('2030-05-01') && card.idList === lToday.id && card.idLabels.includes(green.id), JSON.stringify(card));

  await call(owner, 'PATCH', `/tasks/${tid}`, { title: 'Renamed in Chronos', description: 'new description', stageId: lWeek.id, labelIds: [blue.id] });
  card = await T('GET', `/cards/${cardId}`, { fields: 'name,desc,idList,idLabels' });
  ok('renaming / re-describing / moving / re-labelling in Chronos updates the card', card.name === 'Renamed in Chronos' && card.desc === 'new description' && card.idList === lWeek.id && card.idLabels.length === 1 && card.idLabels[0] === blue.id, JSON.stringify(card));
  await call(owner, 'PATCH', `/tasks/${tid}`, { status: 'completed', overrideReason: 'sync test: the starter subtask is not needed' }); // the starter subtask is required, so completing needs a manager override
  card = await T('GET', `/cards/${cardId}`, { fields: 'dueComplete,closed' });
  ok('completing the task marks the due date complete in Trello', card.dueComplete === true && card.closed === false, JSON.stringify(card));
  await call(owner, 'PATCH', `/tasks/${tid}`, { status: 'todo', deadline: null });
  card = await T('GET', `/cards/${cardId}`, { fields: 'due,dueComplete' });
  ok('reopening and clearing the deadline updates Trello', card.dueComplete === false && card.due === null, JSON.stringify(card));
  const asg = await call(owner, 'PATCH', `/tasks/${tid}`, { assignee: mk.data.id });
  card = await T('GET', `/cards/${cardId}`, { fields: 'idMembers' });
  ok('assigning the matched person adds them to the card', asg.status === 200 && card.idMembers.includes(rushaTrello.id), `${asg.status} ${JSON.stringify(card)}`);
  const quiet = await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
  ok('our own changes do not echo back as Trello edits (no loop)', quiet.data.result.updated === 0 && quiet.data.result.created === 0, JSON.stringify(quiet.data));

  console.log('Trello -> Chronos');
  await T('PUT', `/cards/${cardId}`, {}, { name: 'Edited in Trello', desc: 'trello side', idList: lLater.id, idLabels: green.id, due: '2031-01-02T10:00:00.000Z' });
  const s1 = await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
  const tAfter = (await call(owner, 'GET', `/tasks/${tid}`)).data.task;
  ok('a card edited in Trello is updated in Chronos on sync', s1.data.result.updated >= 1 && tAfter.title === 'Edited in Trello' && tAfter.description === 'trello side' && tAfter.stage === lLater.name, JSON.stringify({ r: s1.data, t: tAfter.title }));
  ok('...including labels and due date', tAfter.labels.length === 1 && tAfter.labels[0].trelloId === green.id && String(tAfter.deadline).startsWith('2031-01-02'), JSON.stringify(tAfter.labels));
  await T('PUT', `/cards/${cardId}`, {}, { dueComplete: true });
  await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
  ok('marking the card complete in Trello completes the task', (await call(owner, 'GET', `/tasks/${tid}`)).data.task.status === 'completed');
  const auto = await call(owner, 'POST', `/trello/projects/${pid}/sync`, { auto: true });
  ok('background refresh is throttled (skipped right after a sync)', auto.data.result.skipped === 'recent', JSON.stringify(auto.data));

  console.log('Checklists');
  const cl = await T('POST', '/checklists', {}, { idCard: cardId, name: 'Test checklist' });
  const i1 = await T('POST', `/checklists/${cl.id}/checkItems`, {}, { name: 'item one' });
  const i2 = await T('POST', `/checklists/${cl.id}/checkItems`, {}, { name: 'item two', checked: 'true' });
  await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
  const subs = (await call(owner, 'GET', `/tasks/${tid}`)).data.subtasks.filter((s) => s.trello?.kind === 'item');
  const s_one = subs.find((s) => s.title === 'item one'), s_two = subs.find((s) => s.title === 'item two');
  ok('checklist items arrive as subtasks with their state', subs.length === 2 && s_one?.status === 'todo' && s_two?.status === 'completed', JSON.stringify(subs.map((s) => [s.title, s.status])));
  await call(owner, 'PATCH', `/tasks/${s_one.id}`, { status: 'completed', title: 'item one (renamed)' });
  const cardCl = await T('GET', `/cards/${cardId}/checklists`);
  const got = cardCl[0].checkItems.find((x) => x.id === i1.id);
  ok('completing / renaming the subtask in Chronos updates the Trello checklist item', got.state === 'complete' && got.name === 'item one (renamed)', JSON.stringify(got));
  await T('PUT', `/cards/${cardId}/checkItem/${i2.id}`, {}, { state: 'incomplete' });
  await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
  ok('un-ticking an item in Trello reopens the subtask', (await call(owner, 'GET', `/tasks/${tid}`)).data.subtasks.find((s) => s.title === 'item two').status === 'todo');
  const delItem = await call(owner, 'DELETE', `/tasks/${s_two.id}`);
  ok('a checklist subtask cannot be deleted in Chronos (it would come back)', delItem.status === 409 && delItem.data.code === 'TRELLO_ITEM');

  console.log('Delete');
  const del = await call(owner, 'DELETE', `/tasks/${tid}`);
  ok('deleting the task works', del.status === 200);
  card = await T('GET', `/cards/${cardId}`, { fields: 'closed' });
  ok('...and archives (does not destroy) the Trello card', card.closed === true);
  const s2 = await call(owner, 'POST', `/trello/projects/${pid}/sync`, {});
  ok('an archived card is not resurrected by the next sync', s2.data.result.created === 0 && !(await call(owner, 'GET', `/tasks?project=${pid}`)).data.some((t) => t.title === 'Edited in Trello'));
} catch (e) {
  fail++; console.log('  ✗ FAIL unexpected error:', e.message);
} finally {
  // clean up everything this test created on Trello
  for (const id of createdCards) { try { await T('DELETE', `/cards/${id}`); } catch (e) { console.log('  (cleanup) could not delete', id, e.message); } }
  await wait(500);
  const after = (await T('GET', `/boards/${BOARD}/cards/all`, { fields: 'name,desc,idList,closed,due,idLabels,idMembers' })).map((c) => JSON.stringify(c)).sort();
  ok('the Trello board is exactly as it was before the test (no stray cards, original cards untouched)', JSON.stringify(before) === JSON.stringify(after), `before ${before.length} / after ${after.length}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
