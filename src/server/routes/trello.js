import { Router } from '../router.js';
import { Project } from '../models/index.js';
import { authenticate, requireRole, notFound, forbidden, bad, canViewProject, isProjectManager } from '../util.js';
import { tGet, trelloConfigured, tFetchFile, tCreateList } from '../trello.js';
import { importBoard, pullBoard } from '../trelloSync.js';

export const trello = Router();
trello.use(authenticate);

// Is Trello set up on the server, and which Trello account does the token belong to?
trello.get('/status', async (req, res) => {
  const configured = trelloConfigured();
  let account = null;
  let error = null;
  if (configured && ['owner', 'manager'].includes(req.user.role)) {
    try {
      const me = await tGet('/members/me', { fields: 'username,fullName' });
      account = { username: me.username, fullName: me.fullName };
    } catch (e) { error = e.message; }
  }
  res.json({ configured, account, error });
});

// Boards the connected Trello account can see (for the import picker)
trello.get('/boards', requireRole('owner', 'manager'), async (_req, res) => {
  const boards = await tGet('/members/me/boards', { fields: 'name,shortLink,url', filter: 'open', organization: 'true', organization_fields: 'displayName' });
  const linked = new Set((await Project.find({ 'trello.boardId': { $ne: null } }).select('trello.boardId')).map((p) => p.trello.boardId));
  res.json(boards.map((b) => ({ id: b.id, name: b.name, shortLink: b.shortLink, url: b.url, workspace: b.organization?.displayName || 'Personal boards', imported: linked.has(b.id) })));
});

// Server-side cache for proxied Trello files, keyed by url. Trello attachment bytes never change once uploaded,
// so this turns every open after the first (by anyone) into an instant hit instead of a fresh round trip to Trello —
// that round trip, repeated for every image on a task, is what makes a card with many attachments feel stuck for a
// couple of seconds on each open. Capped so it can't grow unbounded; oldest entries are evicted first.
const IMAGE_CACHE = new Map();
const IMAGE_CACHE_MAX = 300;
const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000;

// Proxies a Trello-hosted file (e.g. an attachment image linked from a synced comment) through our own OAuth
// credentials, since the browser has no way to attach them to a plain <img src>.
trello.get('/image', async (req, res) => {
  const url = req.query?.url;
  if (!url) throw bad('Missing url');
  const cached = IMAGE_CACHE.get(url);
  let contentType, buf;
  if (cached && Date.now() - cached.ts < IMAGE_CACHE_TTL) {
    ({ contentType, buf } = cached);
  } else {
    const upstream = await tFetchFile(url);
    contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    buf = Buffer.from(await upstream.arrayBuffer());
    IMAGE_CACHE.delete(url); // re-insert at the end so the cache evicts least-recently-used first
    IMAGE_CACHE.set(url, { contentType, buf, ts: Date.now() });
    if (IMAGE_CACHE.size > IMAGE_CACHE_MAX) IMAGE_CACHE.delete(IMAGE_CACHE.keys().next().value);
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(buf);
});

// Create a Chronos project from a Trello board and pull its cards
trello.post('/import', requireRole('owner', 'manager'), async (req, res) => {
  if (!req.body?.board) throw bad('Choose a board or paste its link');
  const { project, result } = await importBoard(req.user, req.body.board);
  res.status(201).json({ id: String(project._id), name: project.name, result });
});

// Pull the latest changes from Trello. `auto` = background refresh (any project member, throttled); manual = managers.
trello.post('/projects/:id/sync', async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project || !canViewProject(req.user, project)) throw notFound('Project not found');
  if (!project.trello?.boardId) throw bad('This project is not linked to Trello');
  const auto = !!req.body?.auto;
  if (!auto && !isProjectManager(req.user, project)) throw forbidden('Only the project manager can sync manually');
  const result = await pullBoard(project, { userId: req.user._id, auto });
  const fresh = await Project.findById(project._id).select('trello.lastSyncAt trello.syncError');
  res.json({ result, lastSyncAt: fresh.trello.lastSyncAt, syncError: fresh.trello.syncError || null });
});

// Create a new list on the linked Trello board (push direction). Managers/owners only.
trello.post('/projects/:id/lists', async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project || !canViewProject(req.user, project)) throw notFound('Project not found');
  if (!project.trello?.boardId) throw bad('This project is not linked to Trello');
  if (!isProjectManager(req.user, project)) throw forbidden('Only the project manager can add a list');
  const name = String(req.body?.name || '').trim();
  if (!name) throw bad('Name the list');
  const list = await tCreateList(project.trello.boardId, name);
  await Project.updateOne({ _id: project._id }, { $push: { 'trello.lists': { id: list.id, name: list.name } } });
  res.status(201).json({ id: list.id, name: list.name });
});
