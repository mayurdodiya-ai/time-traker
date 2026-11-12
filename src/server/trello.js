// Thin client for the Trello REST API (https://developer.atlassian.com/cloud/trello/rest/).
// Credentials come from the server environment only and are sent in a header, never in URLs or logs.
import { HttpError, bad } from './util.js';

const BASE = 'https://api.trello.com/1';

export const trelloConfigured = () => !!(process.env.TRELLO_KEY && process.env.TRELLO_TOKEN);

async function call(method, path, { params, body } = {}, attempt = 0) {
  if (!trelloConfigured())
    throw new HttpError(400, 'Trello is not configured. Add TRELLO_KEY and TRELLO_TOKEN to .env and restart the server.', 'TRELLO_NOT_CONFIGURED');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `OAuth oauth_consumer_key="${process.env.TRELLO_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new HttpError(502, 'Could not reach Trello. Check the internet connection and try again.', 'TRELLO_UNREACHABLE');
  }
  if (res.status === 429 && attempt < 2) {
    // Trello rate limit (about 100 requests / 10 s per token): wait and retry
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return call(method, path, { params, body }, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new HttpError(400, 'Trello refused access. The token cannot see this board (or it was revoked).', 'TRELLO_FORBIDDEN');
    if (res.status === 404) throw new HttpError(400, 'Trello could not find that board or card.', 'TRELLO_NOT_FOUND');
    throw new HttpError(502, `Trello error ${res.status}: ${text.slice(0, 120)}`, 'TRELLO_ERROR');
  }
  return text ? JSON.parse(text) : null;
}

export const tGet = (path, params) => call('GET', path, { params });
export const tPut = (path, body, params) => call('PUT', path, { body, params });
export const tPost = (path, body, params) => call('POST', path, { body, params });
export const tDel = (path, params) => call('DELETE', path, { params });

/** Posts a native comment on a Trello card (shows up as a real Trello comment, author = our connected account). */
export const tAddComment = (cardId, text) => call('POST', `/cards/${cardId}/actions/comments`, { body: { text } });

/** Fetches a Trello-hosted file (card attachments, comment image previews) with the server's OAuth credentials. Raw bytes, not JSON. */
export async function tFetchFile(url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (!/(^|\.)trello\.com$/i.test(host)) throw new HttpError(400, 'Not a Trello URL', 'TRELLO_BAD_URL');
  if (!trelloConfigured()) throw new HttpError(400, 'Trello is not configured. Add TRELLO_KEY and TRELLO_TOKEN to .env and restart the server.', 'TRELLO_NOT_CONFIGURED');
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `OAuth oauth_consumer_key="${process.env.TRELLO_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"` },
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new HttpError(502, 'Could not reach Trello.', 'TRELLO_UNREACHABLE');
  }
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, 'Trello could not serve that file.', 'TRELLO_ERROR');
  return res; // caller streams body + reads content-type
}

/** Uploads a file to a Trello card as an attachment. `file` is a Web File/Blob (e.g. from req.formData()). */
export async function tUploadAttachment(cardId, file) {
  if (!trelloConfigured()) throw new HttpError(400, 'Trello is not configured. Add TRELLO_KEY and TRELLO_TOKEN to .env and restart the server.', 'TRELLO_NOT_CONFIGURED');
  const form = new FormData();
  form.append('file', file, file.name || 'attachment');
  let res;
  try {
    res = await fetch(`${BASE}/cards/${cardId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `OAuth oauth_consumer_key="${process.env.TRELLO_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new HttpError(502, 'Could not reach Trello. Check the internet connection and try again.', 'TRELLO_UNREACHABLE');
  }
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `Trello rejected the upload (${res.status}): ${text.slice(0, 160)}`, 'TRELLO_ERROR');
  return text ? JSON.parse(text) : null;
}

/** Accepts a board URL (https://trello.com/b/AbCd1234/name), the 8-character short link or the 24-character id. */
export function parseBoardRef(input = '') {
  const s = String(input).trim();
  const m = s.match(/trello\.com\/b\/([A-Za-z0-9]+)/i);
  const ref = m ? m[1] : s;
  if (!/^[A-Za-z0-9]{8}$/.test(ref) && !/^[a-f0-9]{24}$/i.test(ref)) throw bad('Enter a Trello board link such as https://trello.com/b/AbCd1234/my-board');
  return ref;
}

const CARD_FIELDS = 'name,desc,due,dueComplete,closed,idList,idLabels,labels,idMembers,shortUrl,dateLastActivity,pos,idShort';

/** All cards of a board (paged, newest first), with their checklists. */
export async function fetchAllCards(boardId, { includeClosed = true } = {}) {
  const out = [];
  let before;
  for (let page = 0; page < 50; page += 1) {
    const batch = await tGet(`/boards/${boardId}/cards/${includeClosed ? 'all' : 'open'}`, {
      fields: CARD_FIELDS, checklists: 'all', checklist_fields: 'name',
      attachments: 'true', attachment_fields: 'name,url,previews,date,bytes,mimeType',
      limit: 1000, before,
    });
    out.push(...batch);
    if (batch.length < 1000) break;
    before = batch.map((c) => c.id).sort()[0]; // card ids start with their creation time: continue with older cards
  }
  return out;
}

/** Creates a new list on a Trello board, appended at the end. */
export const tCreateList = (boardId, name) => tPost('/lists', { idBoard: boardId, name, pos: 'bottom' });

export const BOARD_PARAMS = {
  fields: 'name,url,closed,shortLink',
  lists: 'open', list_fields: 'name',
  labels: 'all', label_fields: 'name,color', label_limit: 1000,
  members: 'all', member_fields: 'fullName,username',
};
