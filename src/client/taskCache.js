import { api, tokenStore } from './api';

// Remembers the last response of GET /tasks/:id so the task panel can open instantly (then refreshes in the background).
// Keyed by the sign-in token, so one user's data is never shown to the next person who signs in on the same browser.
const cache = new Map();
const inflight = new Map();
let epoch = 0; // bumped on every data change; a response that started before the change is thrown away

/** Forget everything remembered. Called whenever tasks / time change (the page's `bump`). */
export function invalidateTaskCache() { epoch += 1; cache.clear(); inflight.clear(); }
const key = (id) => `${tokenStore.get()}|${id}`;

export const getCachedTask = (id) => cache.get(key(id))?.data || null;
export function setCachedTask(id, data) {
  cache.set(key(id), { data, at: Date.now() });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
}
/** Start loading a task before it is clicked (call on hover / focus). Cheap: skipped if fresh or already loading. */
export function prefetchTask(id) {
  const k = key(id);
  const c = cache.get(k);
  if ((c && Date.now() - c.at < 5000) || inflight.has(k)) return;
  const e = epoch;
  inflight.set(k, api.get(`/tasks/${id}`).then((d) => { if (e === epoch) setCachedTask(id, d); }).catch(() => {}).finally(() => inflight.delete(k)));
}
