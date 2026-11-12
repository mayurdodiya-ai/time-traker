// One-off / safety-net command: give ticket numbers to existing tasks that do not have one (it also runs by itself when the server starts).
// Safe for production: it never deletes or renumbers anything.   Usage: npm run backfill-tickets   (with MONGODB_URI set)
import 'dotenv/config';
import mongoose from 'mongoose';
import { ensureTicketNumbers } from './tickets.js';

await mongoose.connect(process.env.MONGODB_URI);
const n = await ensureTicketNumbers();
console.log(n ? `Gave ticket numbers to ${n} existing tickets.` : 'Every ticket already has a number.');
await mongoose.disconnect();
