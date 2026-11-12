// DANGER: deletes ALL data, then creates a single owner account.
// Usage: npm run reset-admin -- you@company.com 'password'
// Refuses to run when NODE_ENV=production unless you pass --force as a third argument.
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, Project, Task, TimeEntry, TimerSession, Comment, AuditEvent, Notification } from './models/index.js';

const [email, password, flag] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error("Usage: npm run reset-admin -- you@company.com 'password (8+ chars)'");
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && flag !== '--force') {
  console.error('Refusing to wipe a production database. Pass --force as the third argument if you really mean it.');
  process.exit(1);
}
await mongoose.connect(process.env.MONGODB_URI);
for (const m of [User, Project, Task, TimeEntry, TimerSession, Comment, AuditEvent, Notification]) await m.deleteMany({});
await mongoose.syncIndexes();
await User.create({ name: 'Admin', email, role: 'owner', title: 'Company Owner', color: '#8b5cf6', passwordHash: await bcrypt.hash(password, 10) });
console.log(`Database "${mongoose.connection.name}" wiped. Owner account created for ${email}.`);
await mongoose.disconnect();
