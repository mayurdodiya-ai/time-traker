// Google sign-in rules, tested on the isolated DB (the Google token check itself needs a real token, so the verified profile is passed in directly).
//   MONGODB_URI=mongodb://127.0.0.1:27017/chronos_test node scripts/test/google.test.mjs   (after seeding that DB)
import 'dotenv/config';
if (!/chronos_test/.test(process.env.MONGODB_URI || '')) { console.error('Refusing to run: MONGODB_URI must point at chronos_test'); process.exit(2); }
const { connectDb } = await import('../../src/server/db.js');
const { googleSignIn } = await import('../../src/server/routes/auth.js');
const { User } = await import('../../src/server/models/index.js');
await connectDb();
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗ FAIL'} ${n}${c ? '' : ' ' + x}`); };
const err = async (f) => { try { await f(); return null; } catch (e) { return e; } };

const known = await googleSignIn({ email: 'priya@acme.test', name: 'Priya Nair' });
ok('an approved user signs in with Google', !!known.token && known.user.email === 'priya@acme.test');

const fresh = await googleSignIn({ email: 'new.person@gmail.com', name: 'New Person' });
const u = await User.findOne({ email: 'new.person@gmail.com' });
ok('an unknown Google account becomes a pending request', fresh.pending === true && u?.pending === true && u.active === false && u.role === 'employee');
ok('...and cannot sign in until approved', (await err(() => googleSignIn({ email: 'new.person@gmail.com', name: 'New Person' })))?.status === 403);

await User.updateOne({ _id: u._id }, { pending: false, active: true });
ok('after approval the same Google account signs in', !!(await googleSignIn({ email: 'new.person@gmail.com', name: 'New Person' })).token);

await User.updateOne({ email: 'sam@acme.test' }, { active: false });
ok('a deactivated user is refused', (await err(() => googleSignIn({ email: 'sam@acme.test', name: 'Sam' })))?.status === 403);

await User.create({ name: 'Backend Node 1', email: 'backendnode1@trello.invalid', pending: true, active: false, trelloMemberId: 'abc123', passwordHash: 'x' });
await googleSignIn({ email: 'backend.real@gmail.com', name: 'backend node 1' });
const claimed = await User.find({ trelloMemberId: 'abc123' });
ok('signing in with Google claims the Trello placeholder with the same name', claimed.length === 1 && claimed[0].email === 'backend.real@gmail.com' && claimed[0].pending, JSON.stringify(claimed));
ok('...without creating a duplicate', (await User.countDocuments({ name: /^backend node 1$/i })) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
