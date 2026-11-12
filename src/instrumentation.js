// Runs once when the server starts: make sure the admin account from .env exists.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  console.log('[seed] seeder started');
  try {
    const { ensureAdmin } = await import('./server/ensure-admin.js');
    console.log(`[seed] admin ${await ensureAdmin()}`);
    const { connectDb } = await import('./server/db.js');
    await connectDb();
    const { ensureTicketNumbers } = await import('./server/tickets.js');
    const n = await ensureTicketNumbers();
    if (n) console.log(`[seed] gave ticket numbers to ${n} existing tickets`);
  } catch (e) {
    console.error('[seed] admin seeding failed:', e.message);
  }
  console.log('[seed] seeder ended');
}
