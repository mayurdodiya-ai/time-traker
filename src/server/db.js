import mongoose from 'mongoose';
import { User, Project, Task, TimeEntry, TimerSession, Comment, AuditEvent, Notification } from './models/index.js';

// Cache the connection on globalThis so dev hot-reloads and serverless warm invocations reuse it.
const cache = (globalThis.__chronosMongo ||= { conn: null, promise: null });

export async function connectDb() {
  if (cache.conn) return cache.conn;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  cache.promise ||= mongoose
    .connect(process.env.MONGODB_URI, { bufferCommands: false, maxPoolSize: 10, serverSelectionTimeoutMS: 8000 })
    .then(async (m) => {
      // Make sure indexes exist (notably the "one running timer per user" unique index). In development we wait for them. In
      // production they already exist after the first run, and checking ~30 indexes one by one before the first response made every
      // cold start of a serverless instance several seconds slower (one round trip each), so there it runs in the background.
      const ensure = Promise.all([User, Project, Task, TimeEntry, TimerSession, Comment, AuditEvent, Notification].map((x) => x.init()));
      if (process.env.NODE_ENV === 'production' && process.env.WAIT_FOR_INDEXES !== 'true') ensure.catch((e) => console.error('index check failed:', e.message));
      else await ensure;
      return m;
    });
  try {
    cache.conn = await cache.promise;
  } catch (e) {
    cache.promise = null; // allow a retry on the next request
    throw e;
  }
  return cache.conn;
}
