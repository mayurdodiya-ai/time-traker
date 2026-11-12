import { Router } from '../router.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { User, Project, ROLES } from '../models/index.js';
import { tGet, trelloConfigured } from '../trello.js';
import { authenticate, requireRole, signToken, bad, notFound, forbidden, audit, notify } from '../util.js';

export const auth = Router();
export const users = Router();

// Roles that can be handed out through the API. The owner is the admin account; viewer is not offered.
const ASSIGNABLE_ROLES = ['manager', 'employee'];

const PALETTE = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ef4444', '#22c55e'];

auth.post('/login', async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+passwordHash');
  if (user?.pending) throw forbidden('Your account is waiting for administrator approval. You will be able to sign in once it is approved.');
  const ok = user && (await bcrypt.compare(String(password), user.passwordHash));
  if (!ok) throw bad('Incorrect email or password');
  if (!user.active) throw forbidden('This account has been deactivated');
  res.json({ token: signToken(user), user });
});

const signupEnabled = () => process.env.ALLOW_SIGNUP === 'true'; // off by default: accounts are created by the admin;
const MAX_PENDING = 50; // stops the approval queue being flooded

const googleClientId = () => process.env.GOOGLE_CLIENT_ID || '';
auth.get('/config', (_req, res) => res.json({ signup: signupEnabled(), googleClientId: googleClientId() || null }));

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Check a Google ID token with Google and return its profile. Throws unless it was issued for THIS app and the email is verified. */
async function verifyGoogleCredential(credential) {
  if (!googleClientId()) throw bad('Google sign-in is not set up on this server');
  let r;
  try { r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(credential || ''))}`); } catch { throw bad('Could not reach Google. Try again.'); }
  const p = await r.json().catch(() => ({}));
  if (!r.ok || p.aud !== googleClientId() || !['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) throw bad('Google sign-in failed. Please try again.');
  if (String(p.email_verified) !== 'true' || !p.email) throw bad('Your Google email address is not verified');
  const domain = (process.env.GOOGLE_ALLOWED_DOMAIN || '').trim().toLowerCase();
  if (domain && String(p.hd || '').toLowerCase() !== domain) throw forbidden(`Only @${domain} Google accounts can sign in here`);
  return { email: String(p.email).toLowerCase(), name: String(p.name || p.email.split('@')[0]).trim() };
}

/**
 * Sign in with a verified Google profile. Known active user: signed in. Unknown email: an access request is created
 * (or a Trello placeholder with the same name is claimed) and waits for the admin, exactly like email sign-up.
 */
export async function googleSignIn({ email, name }) {
  const user = await User.findOne({ email });
  if (user) {
    if (user.pending) throw forbidden('Your account is waiting for administrator approval. You will be able to sign in once it is approved.');
    if (!user.active) throw forbidden('This account has been deactivated');
    return { token: signToken(user), user };
  }
  if (!signupEnabled()) throw forbidden('Sign-up is disabled. Ask your administrator for an invitation.');
  const claim = await User.findOne({ pending: true, email: /@trello\.invalid$/, name: new RegExp(`^${escapeRe(name)}$`, 'i') });
  if (claim) {
    claim.email = email;
    await claim.save();
    await audit(null, 'user.signup', 'User', claim, `${claim.name} (${email}) claimed their Trello access request with Google`);
  } else {
    if ((await User.countDocuments({ pending: true })) >= MAX_PENDING) throw bad('Too many pending requests right now. Please contact your administrator.');
    const count = await User.countDocuments();
    const u = await User.create({
      name: name.slice(0, 80), email, role: 'employee', active: false, pending: true,
      color: PALETTE[count % PALETTE.length], passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), // Google users have no password
    });
    await audit(null, 'user.signup', 'User', u, `${u.name} (${u.email}) requested access with Google`);
    for (const o of await User.find({ role: 'owner', active: true })) await notify(o._id, `${u.name} requested access to Time Tracker`, '/people');
  }
  return { pending: true, name, email };
}

auth.post('/google', async (req, res) => {
  const out = await googleSignIn(await verifyGoogleCredential(req.body?.credential));
  res.status(out.pending ? 202 : 200).json(out);
});

// Self sign-up creates a PENDING employee account: it cannot sign in until an owner approves it.
auth.post('/signup', async (req, res) => {
  if (!signupEnabled()) throw forbidden('Sign-up is disabled. Ask your administrator for an invitation.');
  const { name = '', email = '', password = '' } = req.body || {};
  const cleanEmail = String(email).toLowerCase().trim();
  if (name.trim().length < 2) throw bad('Please enter your full name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw bad('Please enter a valid email address');
  if (String(password).length < 8) throw bad('Password must be at least 8 characters');
  if (await User.exists({ email: cleanEmail })) throw bad('An account with this email already exists');
  // someone added to Trello already has a placeholder request under their name: let them claim it instead of creating a duplicate
  const claim = await User.findOne({ pending: true, email: /@trello\.invalid$/, name: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (claim) {
    claim.email = cleanEmail;
    claim.passwordHash = await bcrypt.hash(String(password), 10);
    await claim.save();
    await audit(null, 'user.signup', 'User', claim, `${claim.name} (${claim.email}) claimed their Trello access request`);
    return res.status(201).json({ ok: true, pending: true });
  }
  if ((await User.countDocuments({ pending: true })) >= MAX_PENDING) throw bad('Too many pending requests right now. Please contact your administrator.');
  const count = await User.countDocuments();
  const user = await User.create({
    name: name.trim().slice(0, 80), email: cleanEmail, role: 'employee', active: false, pending: true,
    color: PALETTE[count % PALETTE.length], passwordHash: await bcrypt.hash(String(password), 10),
  });
  await audit(null, 'user.signup', 'User', user, `${user.name} (${user.email}) requested access`);
  for (const o of await User.find({ role: 'owner', active: true })) await notify(o._id, `${user.name} requested access to Time Tracker`, '/people');
  res.status(201).json({ ok: true, pending: true });
});

auth.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

auth.post('/password', authenticate, async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) throw bad('New password must be at least 8 characters');
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(String(current || ''), user.passwordHash))) throw bad('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(String(next), 10);
  await user.save();
  res.json({ ok: true });
});

// ---- users ----
users.use(authenticate);

// Everyone signed in can see a directory (needed to display assignees); sensitive fields are excluded.
users.get('/', async (req, res) => {
  const filter = req.user.role === 'owner' ? {} : { active: true };
  res.json(await User.find(filter).sort({ name: 1 }));
});

// People on the Trello boards of linked projects, so the owner can say "this Chronos person is that Trello member".
users.get('/trello-members', requireRole('owner'), async (_req, res) => {
  if (!trelloConfigured()) return res.json([]);
  const out = new Map();
  for (const p of await Project.find({ 'trello.boardId': { $ne: null } }).select('trello.boardId')) {
    try {
      for (const m of await tGet(`/boards/${p.trello.boardId}/members`, { fields: 'fullName,username' })) out.set(m.id, { id: m.id, fullName: m.fullName, username: m.username });
    } catch { /* one unreachable board never hides the others */ }
  }
  res.json([...out.values()].sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))));
});

users.post('/', requireRole('owner'), async (req, res) => {
  const { name, email, password, role = 'employee', title = '' } = req.body || {};
  if (!name || !email) throw bad('Name and email are required');
  if (!ASSIGNABLE_ROLES.includes(role)) throw bad('Role must be Project Manager or Employee');
  if (!password || String(password).length < 8) throw bad('Temporary password must be at least 8 characters');
  if (await User.exists({ email: String(email).toLowerCase() })) throw bad('A user with this email already exists');
  const count = await User.countDocuments();
  const user = await User.create({
    name, email, title, role,
    color: PALETTE[count % PALETTE.length],
    passwordHash: await bcrypt.hash(String(password), 10),
  });
  await audit(req.user, 'user.create', 'User', user, `Created account for ${user.name} (${role})`);
  res.status(201).json(user);
});

/**
 * Connect a Chronos person to their Trello member on every linked board, right away (no need to wait for a sync):
 * they join the project team and can be put on Trello cards. Only where they really are a board member, because Trello
 * rejects a card assignment for someone who is not on the board. The next sync then gives them the cards they already sit on in Trello.
 */
async function linkToBoards(user) {
  const tid = user.trelloMemberId;
  for (const p of await Project.find({ 'trello.boardId': { $ne: null } }).select('trello.boardId trello.memberMap')) {
    let map = (p.trello.memberMap || []).filter((m) => String(m.userId) !== String(user._id) && (!tid || m.trelloId !== tid));
    let onBoard = false;
    if (tid) {
      try {
        const members = await tGet(`/boards/${p.trello.boardId}/members`, { fields: 'fullName' });
        if (members.some((m) => m.id === tid)) { map = [...map, { trelloId: tid, userId: user._id }]; onBoard = true; }
      } catch { /* leave this board for the next sync */ }
    }
    await Project.updateOne({ _id: p._id }, { $set: { 'trello.memberMap': map }, ...(onBoard ? { $addToSet: { members: user._id } } : {}) });
  }
}

users.post('/:id/approve', requireRole('owner'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || !user.pending) throw notFound('No pending request found');
  const role = req.body?.role || 'employee';
  if (!ASSIGNABLE_ROLES.includes(role)) throw bad('Role must be Project Manager or Employee');
  if (user.email.endsWith('@trello.invalid')) {
    // created from a Trello member: Trello hides email addresses, so the admin supplies the real login details
    const { email, password } = req.body || {};
    const clean = String(email || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.endsWith('@trello.invalid')) throw bad('Enter this person’s work email to approve them');
    if (!password || String(password).length < 8) throw bad('Enter a temporary password of at least 8 characters');
    if (await User.exists({ email: clean })) throw bad('A user with this email already exists');
    user.email = clean;
    user.passwordHash = await bcrypt.hash(String(password), 10);
  }
  user.pending = false;
  user.active = true;
  user.role = role;
  await user.save();
  if (user.trelloMemberId) await linkToBoards(user); // they now sit on their Trello cards in Chronos too
  await audit(req.user, 'user.approve', 'User', user, `Approved ${user.name} as ${role}`);
  res.json(user);
});

users.post('/:id/ignore', requireRole('owner'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || !user.pending) throw notFound('No pending person found');
  user.trelloIgnored = true; // kept (not deleted) so the next sync does not create them again
  await user.save();
  res.json({ ok: true });
});

users.post('/:id/reject', requireRole('owner'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || !user.pending) throw notFound('No pending request found'); // only never-activated accounts (no history) can be removed
  await user.deleteOne();
  await audit(req.user, 'user.reject', 'User', user, `Declined access request from ${user.name} (${user.email})`);
  res.json({ ok: true });
});

users.patch('/:id', requireRole('owner'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  const { name, title, role, active, password, trelloMemberId, email } = req.body || {};
  if (String(user._id) === String(req.user._id) && (active === false || (role && role !== 'owner')))
    throw bad('You cannot deactivate or demote your own owner account');
  const changes = [];
  if (name !== undefined) user.name = name;
  if (title !== undefined) user.title = title;
  if (role !== undefined) {
    if (role !== user.role && !ASSIGNABLE_ROLES.includes(role)) throw bad('Role must be Project Manager or Employee');
    if (role !== user.role) changes.push(`role ${user.role} → ${role}`);
    user.role = role;
  }
  if (active !== undefined && active !== user.active) {
    changes.push(active ? 'activated' : 'deactivated');
    user.active = !!active; // deactivating never deletes history
  }
  if (password) {
    if (String(password).length < 8) throw bad('Password must be at least 8 characters');
    user.passwordHash = await bcrypt.hash(String(password), 10);
    changes.push('password reset');
  }
  if (email !== undefined && user.pending) {
    // Only a person who is still waiting for approval can get an email here (Trello hides it). An active person's email is their login and never changes.
    const clean = String(email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.endsWith('@trello.invalid')) throw bad('Enter a valid work email');
    if (clean !== user.email) {
      if (await User.exists({ email: clean, _id: { $ne: user._id } })) throw bad('A user with this email already exists');
      user.email = clean;
      changes.push('email set');
    }
  }
  let relink = false;
  if (trelloMemberId !== undefined) {
    const tid = trelloMemberId ? String(trelloMemberId) : null;
    if (tid && (await User.exists({ _id: { $ne: user._id }, trelloMemberId: tid, pending: { $ne: true } }))) throw bad('That Trello account is already linked to someone else');
    if (tid !== (user.trelloMemberId || null)) { user.trelloMemberId = tid; relink = true; changes.push(tid ? 'linked to a Trello account' : 'unlinked from Trello'); }
  }
  await user.save();
  if (relink) {
    if (user.trelloMemberId) await User.deleteMany({ pending: true, trelloMemberId: user.trelloMemberId, _id: { $ne: user._id } }); // the "needs a login" placeholder made for this Trello member is now this person
    await linkToBoards(user);
  }
  if (changes.length) await audit(req.user, 'user.update', 'User', user, `${user.name}: ${changes.join(', ')}`);
  res.json(user);
});
