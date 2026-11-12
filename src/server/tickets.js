// Gives a ticket number to every task / subtask that does not have one yet (oldest first). Safe to run any time: it only touches
// tickets without a number, and numbers come from an atomic counter, so nothing is ever duplicated or renumbered.
// Fast on purpose: it reserves ONE block of numbers and writes them in a few bulk operations (a few round trips for thousands of
// tickets, not two per ticket), because on a hosted database every round trip costs 100+ ms.
import { Task, Counter } from './models/index.js';

const CHUNK = 500;

export async function ensureTicketNumbers(extraFilter = {}) {
  await ensureSubTicketCodes();
  const missing = await Task.find({ ...extraFilter, ticketNumber: null }).sort({ createdAt: 1, _id: 1 }).select('_id').lean();
  if (!missing.length) return 0;
  const counter = await Counter.findOneAndUpdate({ _id: 'ticket' }, { $inc: { seq: missing.length } }, { upsert: true, returnDocument: 'after' });
  const first = counter.seq - missing.length + 1; // the block [first, first + missing.length - 1] belongs to this run
  let assigned = 0;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const ops = missing.slice(i, i + CHUNK).map((t, k) => ({
      // `ticketNumber: null` in the filter: if another server instance numbered this ticket first, this write is simply skipped
      updateOne: { filter: { _id: t._id, ticketNumber: null }, update: { $set: { ticketNumber: first + i + k } }, timestamps: false },
    }));
    assigned += (await Task.bulkWrite(ops, { ordered: false })).modifiedCount;
  }
  return assigned;
}

/** Subtasks created before sub-ticket codes existed get CH-<parent>.<n>, oldest first. Never renumbers a subtask that has a code. */
export async function ensureSubTicketCodes() {
  const missing = await Task.find({ parent: { $ne: null }, ticketCode: '' }).sort({ createdAt: 1, _id: 1 }).select('_id parent').lean();
  let n = 0;
  for (const t of missing) {
    const p = await Task.findByIdAndUpdate(t.parent, { $inc: { subSeq: 1 } }, { returnDocument: 'after', timestamps: false }).select('ticketNumber subSeq');
    if (!p?.ticketNumber) continue;
    await Task.updateOne({ _id: t._id }, { $set: { ticketCode: `CH-${p.ticketNumber}.${p.subSeq}` } }, { timestamps: false });
    n++;
  }
  return n;
}
