import mongoose from 'mongoose';
import { Router, Res } from './router.js';
import { connectDb } from './db.js';
import { auth, users } from './routes/auth.js';
import { projects } from './routes/projects.js';
import { tasks } from './routes/tasks.js';
import { timer, timeEntries } from './routes/time.js';
import { dashboard, reports, notifications, auditLog } from './routes/insights.js';
import { trello } from './routes/trello.js';
import { COMPANY_TZ } from './util.js';

const root = Router();
root.get('/health', (_req, res) => res.json({ ok: true, tz: COMPANY_TZ, db: mongoose.connection.readyState === 1 }));
root.use('/auth', auth);
root.use('/users', users);
root.use('/projects', projects);
root.use('/tasks', tasks);
root.use('/timer', timer);
root.use('/time-entries', timeEntries);
root.use('/dashboard', dashboard);
root.use('/reports', reports);
root.use('/notifications', notifications);
root.use('/audit', auditLog);
root.use('/trello', trello);

function errorResponse(res, err) {
  if (err.name === 'ValidationError') return res.status(400).json({ error: Object.values(err.errors)[0].message });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier supplied' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message, code: err.code });
}

/** Next.js route-handler entry: Request -> Response. */ 
export async function handle(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const res = new Res();
  const req = {
    method: request.method,
    path,
    headers: Object.fromEntries(request.headers),
    query: Object.fromEntries(url.searchParams),
    params: {},
    body: {},
  };
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      if ((request.headers.get('content-type') || '').startsWith('multipart/form-data')) {
        req.formData = await request.formData(); // file uploads: kept as-is, never JSON-parsed
      } else {
        const text = await request.text();
        if (text) {
          try { req.body = JSON.parse(text); } catch { return res.status(400).json({ error: 'Request body must be valid JSON' }).toResponse(); }
        }
      }
    }
    if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET || '').length < 32) {
      console.error('JWT_SECRET must be set to a random string of at least 32 characters in production.');
      return res.status(500).json({ error: 'Server is not configured correctly' }).toResponse();
    }
    await connectDb();
    if (!(await root.handle(req, res, path))) res.status(404).json({ error: 'Endpoint not found' });
  } catch (err) {
    errorResponse(res, err);
  }
  return res.toResponse();
}
