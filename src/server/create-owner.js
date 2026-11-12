// Creates the first owner account (safe for production; unlike seed.js it never deletes data).
// Usage: node src/server/create-owner.js "Full Name" email@company.com 'password' 
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from './models/index.js';

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password || password.length < 8) {
  console.error('Usage: node src/server/create-owner.js "Full Name" email@company.com \'password (8+ chars)\'');
  process.exit(1);
}
await mongoose.connect(process.env.MONGODB_URI);
if (await User.exists({ email: email.toLowerCase() })) {
  console.error('A user with that email already exists.');
  process.exit(1);
}
await User.create({ name, email, role: 'owner', title: 'Company Owner', color: '#8b5cf6', passwordHash: await bcrypt.hash(password, 10) });
console.log(`Owner account created for ${email}`);
await mongoose.disconnect();
