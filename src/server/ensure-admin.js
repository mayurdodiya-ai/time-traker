// Creates the admin (owner) account from ADMIN_* env vars if it does not exist yet. Never deletes or overwrites data.
import bcrypt from 'bcryptjs';
import { connectDb } from './db.js';
import { User } from './models/index.js';

export async function ensureAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return 'skipped (ADMIN_EMAIL / ADMIN_PASSWORD not set)';
  await connectDb();
  const email = ADMIN_EMAIL.toLowerCase().trim();
  if (await User.exists({ email })) return `exists (${email})`;
  await User.create({ name: ADMIN_NAME || 'Admin', email, role: 'owner', title: 'Company Owner', color: '#8b5cf6', passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10) });
  return `created (${email})`;
}
