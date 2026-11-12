// Admin team analytics (/dashboard/people), cross-checked against the existing report totals. Run on the throwaway DB.
import 'dotenv/config';
const API = process.env.API || 'http://localhost:3001/api';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗ FAIL'} ${n}${c ? '' : ' ' + x}`); };
async function call(token, path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const login = async (email) => (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password@123' }) })).json()).token;
const owner = await login('olivia@acme.test');
const d = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const from = d(29), to = d(0);

const r = await call(owner, `/dashboard/people?from=${from}&to=${to}`);
ok('the admin gets the analytics', r.status === 200 && Array.isArray(r.data.people), JSON.stringify(r.data).slice(0, 200));
const A = r.data;
ok('every team member except read-only viewers is listed', A.people.length > 0 && !A.people.some((p) => p.user.role === 'viewer'));
ok('people are sorted by tracked time', A.people.every((p, i) => i === 0 || A.people[i - 1].seconds >= p.seconds));
ok('the total equals the sum of the people', A.totals.seconds === A.people.reduce((s, p) => s + p.seconds, 0));
ok('approval split adds up to each person’s total', A.people.every((p) => Object.values(p.byApproval).reduce((a, b) => a + b, 0) === p.seconds));
ok('project split adds up to each person’s total', A.people.every((p) => p.byProject.reduce((a, b) => a + b.seconds, 0) === p.seconds));
ok('daily series covers every day of the period and adds up', A.people.every((p) => p.daily.length === 30 && p.daily.reduce((a, b) => a + b.seconds, 0) === p.seconds));
ok('active days are the days with time', A.people.every((p) => p.activeDays === p.daily.filter((x) => x.seconds > 0).length));
ok('top tasks are limited and sorted', A.people.every((p) => p.topTasks.length <= 5 && p.topTasks.every((t, i) => i === 0 || p.topTasks[i - 1].seconds >= t.seconds)));

const rep = await call(owner, `/reports/summary?from=${from}&to=${to}`);
ok('it matches the Reports totals for the same period', rep.data.totalSeconds >= A.totals.seconds && A.people.every((p) => (rep.data.byUser.find((u) => u.user.id === p.user.id)?.seconds || 0) === p.seconds),
  `${rep.data.totalSeconds} vs ${A.totals.seconds}`);

const short = await call(owner, `/dashboard/people?from=${d(0)}&to=${d(0)}`);
ok('a one-day period works', short.status === 200 && short.data.people[0].daily.length === 1);
ok('a reversed period is refused', (await call(owner, `/dashboard/people?from=${d(0)}&to=${d(5)}`)).status === 400);
ok('a period over a year is refused', (await call(owner, `/dashboard/people?from=${d(400)}&to=${d(0)}`)).status === 400);
ok('a manager cannot open it', (await call(await login('raj@acme.test'), '/dashboard/people')).status === 403);
ok('an employee cannot open it', (await call(await login('priya@acme.test'), '/dashboard/people')).status === 403);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
