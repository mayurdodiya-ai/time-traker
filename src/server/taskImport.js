// Bulk task import from an .xlsx sheet (admin only).
//  parseSheet()    : .xlsx buffer -> raw rows of plain strings (what the preview shows and the client sends back)
//  resolveRows()   : validates raw rows against a project (assignee, list, labels, ...) -> normalized data or errors
//  buildTemplate() : a ready-to-fill workbook with dropdowns for this project's lists / people
// Rows are always re-validated on the server at commit time, so the client is never trusted.
import ExcelJS from 'exceljs';
import { Task, User, TASK_STATUSES, PRIORITIES } from './models/index.js';
import { isLinked } from './trelloSync.js';

export const MAX_ROWS = 200;
export const MAX_SUBTASKS = 30;

// field -> accepted header spellings (headers are compared lowercase with everything but letters/digits removed)
const HEADERS = {
  title: ['title', 'task', 'taskname', 'name', 'cardtitle', 'cardname'],
  requirement: ['requirement', 'requirements', 'description', 'desc', 'details'],
  criteria: ['acceptancecriteria', 'criteria', 'completioncriteria'],
  list: ['list', 'stage', 'column', 'trellolist', 'sprint'],
  priority: ['priority'],
  assignee: ['assignee', 'assignedto', 'assignto', 'owner'],
  collaborators: ['collaborators', 'collaborator'],
  status: ['status'],
  deadline: ['deadline', 'duedate', 'due'],
  estimate: ['estimatehours', 'estimateh', 'estimatehrs', 'estimate', 'hours'],
  labels: ['labels', 'label', 'tags'],
  trello: ['createintrello', 'intrello', 'sendtotrello', 'addtotrello'],
  subtasks: ['subtasks', 'subtask', 'checklist'],
};
export const COLUMNS = [
  ['title', 'Title'], ['requirement', 'Requirement'], ['criteria', 'Acceptance criteria'], ['list', 'List'], ['priority', 'Priority'],
  ['assignee', 'Assignee'], ['collaborators', 'Collaborators'], ['status', 'Status'], ['deadline', 'Deadline'],
  ['labels', 'Labels'], ['subtasks', 'Subtasks'], ['trello', 'Create in Trello'],
];
const fieldOfHeader = (h) => {
  const k = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.keys(HEADERS).find((f) => HEADERS[f].includes(k)) || null;
};

const pad = (n) => String(n).padStart(2, '0');

/** Any Excel cell value -> plain text (rich text, hyperlinks, formulas and dates are flattened). */
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`; // Excel dates carry no timezone
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return cellText(v.text);
    if ('error' in v) return '';
    return '';
  }
  return String(v).trim();
}

export async function parseSheet(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { const e = new Error('That file could not be read. Upload an Excel .xlsx file (use the template).'); e.status = 400; throw e; }
  const ws = wb.getWorksheet('Tasks') || wb.worksheets[0];
  if (!ws) { const e = new Error('The workbook has no sheets'); e.status = 400; throw e; }
  const fields = [];
  const ignoredColumns = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const name = cellText(cell.value);
    const f = fieldOfHeader(name);
    if (f && !fields.some((x) => x.f === f)) fields.push({ f, col });
    else if (name) ignoredColumns.push(name);
  });
  if (!fields.some((x) => x.f === 'title')) { const e = new Error('The first row must have a "Title" column. Download the template to see the expected columns.'); e.status = 400; throw e; }
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = { n: r };
    let any = false;
    for (const { f, col } of fields) { raw[f] = cellText(row.getCell(col).value); if (raw[f]) any = true; }
    if (!any) continue; // blank row
    rows.push(raw);
    if (rows.length > MAX_ROWS) { const e = new Error(`Too many rows. Import at most ${MAX_ROWS} tasks at a time.`); e.status = 400; throw e; }
  }
  if (!rows.length) { const e = new Error('No tasks found in the sheet. Fill in at least one row below the header.'); e.status = 400; throw e; }
  return { rows, ignoredColumns };
}

const norm = (s) => String(s || '').trim().toLowerCase();
const splitList = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

function parseDeadline(s) {
  if (!s) return { value: null };
  let y, m, d, x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [+x[1], +x[2], +x[3]]; // day first
  else return { error: `Deadline "${s}" is not a date. Use YYYY-MM-DD or DD/MM/YYYY` };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { error: `Deadline "${s}" is not a real date` };
  return { value: dt, text: `${y}-${pad(m)}-${pad(d)}` };
}

function parseEstimate(s) {
  if (s === '') return { value: null };
  let h;
  const hm = /^(\d+):([0-5]?\d)$/.exec(s);
  if (hm) h = +hm[1] + +hm[2] / 60;
  else h = Number(String(s).replace(',', '.'));
  if (!Number.isFinite(h) || h < 0 || h > 10000) return { error: `Estimate "${s}" must be a number of hours (e.g. 2 or 1.5) or H:MM` };
  return { value: Math.round(h * 3600), hours: Math.round(h * 100) / 100 };
}

/** The people a project's work can be assigned to: its team plus its manager (same rule as assertAssignable). */
export async function projectPeople(project) {
  const ids = [...new Set([...(project.members || []), project.manager].filter(Boolean).map(String))];
  return User.find({ _id: { $in: ids }, active: true, pending: { $ne: true }, role: { $ne: 'viewer' } }).select('name email').lean();
}

function personResolver(people) {
  const byEmail = new Map(people.map((u) => [norm(u.email), u]));
  const byName = new Map();
  for (const u of people) byName.set(norm(u.name), [...(byName.get(norm(u.name)) || []), u]);
  return (text) => {
    const k = norm(text);
    if (byEmail.has(k)) return { user: byEmail.get(k) };
    const hits = byName.get(k) || [];
    if (hits.length === 1) return { user: hits[0] };
    if (hits.length > 1) return { error: `"${text}" matches more than one person. Use their email instead` };
    return { error: `"${text}" is not an active member of this project's team` };
  };
}

const slug = (s) => norm(s).replace(/[\s-]+/g, '_');
const STATUS_ALIASES = { done: 'completed', complete: 'completed', closed: 'completed', 'to do': 'todo', open: 'todo', inprogress: 'in_progress', doing: 'in_progress', review: 'in_review', canceled: 'cancelled' };

/**
 * Validate raw rows against a project. Returns one entry per row:
 *   { n, raw, errors: [], warnings: [], duplicate, data, view }
 * `data` (only when there are no errors) is what createTask needs; `view` is a display summary for the preview table.
 */
export async function resolveRows(project, rawRows, { defaultListId, forceListId, defaultStatus } = {}) {
  const linked = isLinked(project);
  const hasBoard = !!project.trello?.boardId;
  // Trello lists (when Trello is reachable) plus the project's Chronos-only lists
  const lists = [...(linked ? project.trello.lists || [] : []), ...(project.localLists || []).map((l) => ({ id: l.id, name: l.name, local: true }))];
  const labels = linked ? project.trello.labels || [] : [];
  // a row with no List goes to the chosen default list; on a project WITHOUT Trello that means the normal status columns unless one was chosen
  const defaultList = lists.find((l) => l.id === defaultListId) || (linked ? lists[0] : null) || null;
  const forced = forceListId ? lists.find((l) => l.id === forceListId) : null;
  const resolvePerson = personResolver(await projectPeople(project));

  // titles that already exist in each list, so re-uploading the same sheet doesn't double the board
  const existing = new Set();
  for (const t of await Task.find({ project: project._id, parent: null, status: { $ne: 'cancelled' } }).select('title stage').lean())
    existing.add(`${norm(t.stage)}|${norm(t.title)}`);

  return rawRows.map((raw) => {
    const errors = [];
    const warnings = [];
    const str = (k) => String(raw[k] ?? '').trim();
    const title = str('title');
    if (!title) errors.push('Title is required');
    else if (title.length > 300) errors.push('Title is longer than 300 characters');

    // list (Trello column)
    let list = null;
    if (forced) list = forced; // imported from a list header: the sheet's List column does not apply
    else if (lists.length) {
      if (str('list')) {
        list = lists.find((l) => norm(l.name) === norm(str('list')));
        if (!list) errors.push(`List "${str('list')}" does not exist on the board. Available: ${lists.map((l) => l.name).join(', ')}`);
      } else list = defaultList;
    } else if (str('list')) warnings.push('This project is not linked to a Trello board, so the List column is ignored');

    // priority & status
    let priority = 'medium';
    if (str('priority')) {
      priority = slug(str('priority'));
      if (!PRIORITIES.includes(priority)) errors.push(`Priority "${str('priority')}" must be one of: ${PRIORITIES.join(', ')}`);
    }
    let status = TASK_STATUSES.includes(defaultStatus) ? defaultStatus : 'todo'; // a row with no Status gets the column it was imported into
    if (str('status')) {
      const s = slug(str('status'));
      status = TASK_STATUSES.includes(s) ? s : STATUS_ALIASES[norm(str('status'))] || STATUS_ALIASES[s];
      if (!status) { errors.push(`Status "${str('status')}" must be one of: ${TASK_STATUSES.join(', ')}`); status = 'todo'; }
    }

    // people
    // a task can be assigned to several people: the first one is the main assignee, the others join it
    let assignee = null;
    const alsoAssigned = [];
    splitList(str('assignee')).forEach((name, i) => {
      const r = resolvePerson(name);
      if (r.error) errors.push(`Assignee: ${r.error}`);
      else if (i === 0) assignee = r.user;
      else alsoAssigned.push(name);
    });
    const collaborators = [];
    for (const c of [...alsoAssigned, ...splitList(str('collaborators'))]) {
      const r = resolvePerson(c);
      if (r.error) errors.push(`Collaborator: ${r.error}`);
      else if (!collaborators.some((u) => String(u._id) === String(r.user._id)) && String(r.user._id) !== String(assignee?._id)) collaborators.push(r.user);
    }

    // dates, estimate
    const dl = parseDeadline(str('deadline'));
    if (dl.error) errors.push(dl.error);
    if (str('estimate')) warnings.push('Hours are set on subtasks (write them as "Design | 2" in the Subtasks column), so the Estimate column is ignored');

    // labels (Trello colour tags)
    const labelIds = [];
    if (str('labels')) {
      if (!linked) warnings.push('This project is not linked to a Trello board, so the Labels column is ignored');
      else for (const name of splitList(str('labels'))) {
        const l = labels.find((x) => norm(x.name || x.color) === norm(name));
        if (!l) errors.push(`Label "${name}" does not exist on the board. Available: ${labels.map((x) => x.name || x.color).filter(Boolean).join(', ') || 'none'}`);
        else if (!labelIds.includes(l.id)) labelIds.push(l.id);
      }
    }

    // subtasks: one per line or separated by ";". Hours go after a bar, e.g. "Design login | 1.5" or "Test | 0:45".
    let subtasks = [];
    const lines = String(raw.subtasks || '').split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
    if (lines.length > MAX_SUBTASKS) errors.push(`At most ${MAX_SUBTASKS} subtasks per task`);
    else for (const line of lines) {
      const m = /^(.*\S)\s*\|\s*([^|]*)$/.exec(line);
      const title = (m ? m[1] : line).trim();
      const est = m ? parseEstimate(m[2].trim().replace(/\s*h(ours?)?$/i, '')) : { value: null };
      if (est.error) errors.push(`Subtask "${title}": ${est.error}`);
      if (title.length > 300) errors.push('A subtask title is longer than 300 characters');
      subtasks.push({ title, estimateSeconds: est.value ?? null });
    }
    const subHours = subtasks.reduce((n, x) => n + (x.estimateSeconds || 0), 0);

    const inTrello = !['no', 'n', 'false', '0', 'chronos', 'chronos only', 'chronosonly'].includes(norm(str('trello'))) && !list?.local;

    // duplicates (against the board, and against earlier rows of this same file)
    const key = `${norm(list?.name || '')}|${norm(title)}`;
    const duplicate = !!title && existing.has(key);
    if (title) existing.add(key);

    const data = errors.length ? null : {
      title, description: str('requirement'), criteria: str('criteria'), status, priority,
      assignee: assignee?._id || null, collaborators: collaborators.map((u) => u._id),
      deadline: dl.value || null, estimateSeconds: null, stageId: list?.id, labelIds, subtasks, inTrello,
    };
    const view = {
      title, list: list?.name || '', priority, status, assignee: assignee?.name || '', collaborators: collaborators.map((u) => u.name),
      deadline: dl.text || '', inTrello, estimateHours: subHours ? Math.round((subHours / 3600) * 100) / 100 : null, labels: labelIds.map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean), subtasks: subtasks.length,
    };
    return { n: raw.n, raw, errors, warnings, duplicate, data, view };
  });
}

/** A workbook the admin can fill in: header row + dropdowns for priority/status/list/assignee, plus a guide sheet. */
export async function buildTemplate(project) {
  const linked = isLinked(project);
  const people = await projectPeople(project);
  const lists = [...(linked ? (project.trello.lists || []).map((l) => l.name) : []), ...(project.localLists || []).map((l) => l.name)];
  const labels = linked ? (project.trello.labels || []).map((l) => l.name || l.color).filter(Boolean) : [];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tasks', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([, label], i) => ({ header: label, key: label, width: [34, 44, 34, 20, 12, 28, 28, 14, 14, 22, 44, 16][i] }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  ws.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  ws.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
  ws.getColumn(12).alignment = { wrapText: true, vertical: 'top' };

  const lookups = wb.addWorksheet('Lookups', { state: 'hidden' });
  lookups.getColumn(1).values = ['Lists', ...lists];
  lookups.getColumn(2).values = ['People', ...people.map((p) => p.email)];
  const col = (field) => COLUMNS.findIndex(([f]) => f === field) + 1;
  const dropdown = (field, formula) => {
    for (let r = 2; r <= MAX_ROWS + 1; r++) ws.getCell(r, col(field)).dataValidation = { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: false };
  };
  dropdown('priority', `"${PRIORITIES.join(',')}"`);
  dropdown('status', `"${TASK_STATUSES.join(',')}"`);
  dropdown('trello', '"yes,no"');
  if (lists.length) dropdown('list', `Lookups!$A$2:$A$${lists.length + 1}`);
  if (people.length) dropdown('assignee', `Lookups!$B$2:$B$${people.length + 1}`);

  const guide = wb.addWorksheet('Guide');
  guide.getColumn(1).width = 22;
  guide.getColumn(2).width = 100;
  guide.addRows([
    [`Import tasks into "${project.name}"`],
    [],
    ['Column', 'What to enter'],
    ['Title *', 'Required. One row = one task (a Trello card when the project is linked).'],
    ['Requirement', 'The task description / what must be delivered.'],
    ['Acceptance criteria', 'Optional completion criteria.'],
    ['List', lists.length ? `The board list the task goes into. One of: ${lists.join(', ')}. Lists that exist only in Chronos create no Trello card. Leave blank to use the list chosen in the import dialog.` : 'Ignored: this project is not linked to a Trello board.'],
    ['Priority', `One of: ${PRIORITIES.join(', ')}. Blank = medium.`],
    ['Assignee', 'Email (best) or full name of a project team member. A task can have several people: separate them with commas (the first is the main person). Subtasks created from the sheet go to the first person. Blank = unassigned.'],
    ['Collaborators', 'More people on the task (optional): comma-separated emails or names. Same as adding extra names to Assignee.'],
    ['Status', `One of: ${TASK_STATUSES.join(', ')}. Blank = todo.`],
    ['Deadline', 'YYYY-MM-DD or DD/MM/YYYY (or a real Excel date).'],
    ['Labels', linked ? `Comma-separated Trello labels. Available: ${labels.join(', ') || 'none'}` : 'Ignored: this project is not linked to a Trello board.'],
    ['Create in Trello', 'yes (default) or no. "no" = the task exists only in Chronos and never reaches Trello. A task in a Chronos-only list is always Chronos-only.'],
    ['Subtasks', 'One subtask per line (Alt+Enter in a cell) or separated by semicolons. Put the hours after a bar: "Design login | 1.5" or "Test | 0:45". Hours belong to subtasks: the task total is their sum.'],
  ]);
  guide.getRow(1).font = { bold: true, size: 14 };
  guide.getRow(3).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
