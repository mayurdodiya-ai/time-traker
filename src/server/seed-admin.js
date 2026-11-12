// Usage: npm run seed:admin  — creates the admin from .env if missing (safe; unlike seed.js it never deletes data).
import 'dotenv/config';
import mongoose from 'mongoose';
import { ensureAdmin } from './ensure-admin.js';

console.log(`admin ${await ensureAdmin()}`);
await mongoose.disconnect();
