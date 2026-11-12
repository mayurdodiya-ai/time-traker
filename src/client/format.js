export const H = 3600;

/** 12300 -> "03:25"  (HH:MM, minutes rounded; an empty value shows "—") */
export function fmtHM(sec) {
  if (sec == null) return '—';
  const total = Math.max(0, Math.round(Math.max(0, sec) / 60)); // whole minutes
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 3725 -> "01:02:05" */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export const hoursOf = (sec) => Math.round((sec / 3600) * 10) / 10;

const dFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dyFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDate = (d) => (d ? dFmt.format(new Date(d)) : '—');
export const fmtDateY = (d) => (d ? dyFmt.format(new Date(d)) : '—');
export const fmtDay = (str) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${str}T12:00:00`));
export const fmtTime = (d) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(d));
export const ago = (d) => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
};

export const pad = (n) => String(n).padStart(2, '0');
export const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDaysStr = (str, n) => {
  const d = new Date(`${str}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dateStr(d);
};
export const weekStart = (str = dateStr()) => {
  const d = new Date(`${str}T12:00:00`);
  return addDaysStr(str, -((d.getDay() + 6) % 7));
};
export const toInputDate = (d) => (d ? dateStr(new Date(d)) : '');

export const STATUS = {
  todo: { label: 'To Do', color: 'var(--text-3)' },
  in_progress: { label: 'In Progress', color: 'var(--info)' },
  blocked: { label: 'Blocked', color: 'var(--danger)' },
  in_review: { label: 'In Review', color: 'var(--warn)' },
  completed: { label: 'Completed', color: 'var(--success)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-3)' },
};
export const PRIORITY = {
  low: { label: 'Low', color: 'var(--text-3)' },
  medium: { label: 'Medium', color: 'var(--info)' },
  high: { label: 'High', color: 'var(--warn)' },
  urgent: { label: 'Urgent', color: 'var(--danger)' },
};
export const PROJECT_STATUS = {
  planning: { label: 'Planning', color: 'var(--info)' },
  active: { label: 'Active', color: 'var(--success)' },
  on_hold: { label: 'On Hold', color: 'var(--warn)' },
  completed: { label: 'Completed', color: 'var(--success)' },
  archived: { label: 'Archived', color: 'var(--text-3)' },
};
export const APPROVAL = {
  draft: { label: 'Draft', color: 'var(--text-3)' },
  submitted: { label: 'Submitted', color: 'var(--warn)' },
  approved: { label: 'Approved', color: 'var(--success)' },
  rejected: { label: 'Rejected', color: 'var(--danger)' },
};
export const ROLE_LABEL = { owner: 'Owner', manager: 'Project Manager', employee: 'Employee', viewer: 'Viewer' };

export const isOverdue = (t) => t.deadline && !['completed', 'cancelled'].includes(t.status) && new Date(t.deadline) < new Date();

/** Mirrors the server rule: estimate used up when used >= estimate, or under a minute remains. */
export const estimateUsedUp = (total, estimate) => estimate != null && estimate > 0 && (estimate - total <= 0 || (estimate >= 120 && estimate - total < 60));

/** Seconds -> ['1', '30'] (hours, minutes as strings); null (no estimate) -> ['', '']. */
export function splitDuration(seconds) {
  if (seconds == null) return ['', ''];
  const total = Math.max(0, Math.round(seconds / 60)); // whole minutes
  return [String(Math.floor(total / 60)), String(total % 60)];
}

/** ('1', '30') -> 5400. Both empty -> null (no estimate). One filled -> the other counts as 0. Never negative. */
export function joinDuration(h, m) {
  if (String(h).trim() === '' && String(m).trim() === '') return null;
  const hh = Math.max(0, Number(h) || 0);
  const mm = Math.max(0, Number(m) || 0);
  return Math.round(hh * 3600 + mm * 60);
}

/** A ticket's unique card number, e.g. #2729 (empty until the server has numbered it). */
export const ticketLabel = (t) => t?.ticketCode || (t?.ticketNumber ? `CH-${t.ticketNumber}` : '');

/** The card's own number in Trello (e.g. 7), only for tickets that really have a Trello card. */
export const trelloNumber = (t) => (!t?.parent && !t?.chronosOnly && t?.trello?.kind === 'card' && t.trello.idShort != null ? t.trello.idShort : null);
