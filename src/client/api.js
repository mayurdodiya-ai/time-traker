const KEY = 'chronos_token';
export const tokenStore = {
  get: () => localStorage.getItem(KEY),
  set: (t) => localStorage.setItem(KEY, t),
  clear: () => localStorage.removeItem(KEY),
};

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---- "busy" tracking: while a change is being saved (it may be waiting on Trello) the whole screen is blocked by a loader,
// so nobody edits something else or repeats the same action. Quick saves never flash it (it appears after a short delay).
const QUIET = /^\/(auth|timer|time-entries|notifications|audit|dashboard|reports)(\/|\?|$)/; // frequent/background calls that never block
const busy = { count: 0, label: '', shown: false, timer: null, subs: new Set() };
const emit = () => busy.subs.forEach((f) => f());
export const busyStore = {
  subscribe: (f) => { busy.subs.add(f); return () => busy.subs.delete(f); },
  get: () => (busy.shown ? busy.label : ''),
};
function busyBegin(label) {
  busy.count += 1;
  busy.label = label;
  if (busy.count === 1) busy.timer = setTimeout(() => { busy.shown = true; emit(); }, 250);
}
function busyEnd() {
  busy.count = Math.max(0, busy.count - 1);
  if (busy.count === 0) { clearTimeout(busy.timer); if (busy.shown) { busy.shown = false; emit(); } }
}
const blocks = (method, path, body) => method !== 'GET' && !QUIET.test(path) && !(body && body.auto === true); // background refreshes (auto: true) never block
const labelFor = (path) => (/^\/trello\/(import|projects)/.test(path) ? 'Syncing with Trello…' : /^\/tasks\/[^/]+\/(comments|attachment|add-to-trello)/.test(path) ? 'Sending to Trello…' : 'Saving…');

async function request(path, { method = 'GET', body } = {}) {
  const block = blocks(method, path, body);
  if (block) busyBegin(labelFor(path));
  try { return await send(path, { method, body }); } finally { if (block) busyEnd(); }
}

async function send(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(tokenStore.get() && { Authorization: `Bearer ${tokenStore.get()}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0, 'NETWORK');
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    tokenStore.clear();
    window.dispatchEvent(new Event('chronos:signout'));
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body = {}) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  async download(path, filename) {
    const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    if (!res.ok) throw new ApiError('Export failed', res.status);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  },
  /** Fetches an authenticated file and returns a local object URL (e.g. for an <img src>). Caller must revoke it when done. */
  async blobUrl(path) {
    const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    if (!res.ok) throw new ApiError('Could not load file', res.status);
    return URL.createObjectURL(await res.blob());
  },
  /** Uploads a file as multipart/form-data (no Content-Type set manually, so the browser adds the correct boundary). */
  async upload(path, file, fields = {}) {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => v != null && form.append(k, v));
    form.append('file', file);
    busyBegin('Uploading…');
    let res; let data;
    try {
      res = await fetch(`/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${tokenStore.get()}` }, body: form });
      data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    } finally { busyEnd(); }
    if (!res.ok) throw new ApiError(data?.error || `Upload failed (${res.status})`, res.status, data?.code);
    return data;
  },
};

export const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
