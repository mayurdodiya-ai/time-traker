import { handle } from '../../../server/app.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const handler = (request) => handle(request);
export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE };
