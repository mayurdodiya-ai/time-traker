import { Children, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { X, Inbox, Check } from 'lucide-react';
import { STATUS, PRIORITY, PROJECT_STATUS, APPROVAL } from './format';

/* ------------------------------------------------ data hook (keeps stale data visible while reloading) */
export function useFetch(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    return fn()
      .then((data) => n === seq.current && setState({ data, loading: false, error: null }))
      .catch((error) => n === seq.current && setState((s) => ({ ...s, loading: false, error })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

/* ------------------------------------------------ small pieces */
const initials = (n = '?') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function Avatar({ user, size = 30, title }) {
  if (!user) return <span className="avatar" style={{ '--s': `${size}px`, '--c': 'var(--surface-2)', color: 'var(--text-3)' }} title="Unassigned">?</span>;
  return <span className="avatar" style={{ '--s': `${size}px`, '--c': user.color }} title={title || user.name}>{initials(user.name)}</span>;
}

export function Avatars({ users = [], max = 4, size = 28 }) {
  const shown = users.slice(0, max);
  return (
    <span className="avatars">
      {shown.map((u) => <Avatar key={u.id} user={u} size={size} />)}
      {users.length > max && <span className="avatar" style={{ '--s': `${size}px`, '--c': 'var(--surface-2)', color: 'var(--text-2)' }}>+{users.length - max}</span>}
    </span>
  );
}

export const Badge = ({ color, children, dot = true }) => (
  <span className="badge" style={{ '--c': color }}>{dot && <i />}{children}</span>
);
export const StatusBadge = ({ status }) => <Badge color={STATUS[status]?.color}>{STATUS[status]?.label}</Badge>;
export const PriorityBadge = ({ priority }) => <Badge color={PRIORITY[priority]?.color}>{PRIORITY[priority]?.label}</Badge>;
export const ProjectStatusBadge = ({ status }) => <Badge color={PROJECT_STATUS[status]?.color}>{PROJECT_STATUS[status]?.label}</Badge>;
export const ApprovalBadge = ({ status }) => <Badge color={APPROVAL[status]?.color}>{APPROVAL[status]?.label}</Badge>;

export function Progress({ value = 0, over = false, thin = false }) {
  return <div className={`progress ${over ? 'over' : ''} ${thin ? 'thin' : ''}`}><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

export function Ring({ value = 0, size = 52, stroke = 5, color = 'var(--primary-2)' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * Math.min(100, value)) / 100} style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <b>{Math.round(value)}%</b>
    </span>
  );
}

export function Stat({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="card stat hover" style={color ? { '--ic': color[0], '--ic-glow': color[1] } : undefined}>
      <div className="ico"><Icon size={20} /></div>
      <div className="val tnum">{value}</div>
      <div className="lbl">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="empty">
      <div className="ico"><Icon size={26} /></div>
      <b>{title}</b>
      <div className="small">{children}</div>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export const Skeleton = ({ h = 20, w = '100%', style }) => <div className="skeleton" style={{ height: h, width: w, ...style }} />;
export const PageSkeleton = () => (
  <div className="stack" style={{ gap: 18 }}>
    <Skeleton h={34} w={260} />
    <div className="grid g4"><Skeleton h={130} /><Skeleton h={130} /><Skeleton h={130} /><Skeleton h={130} /></div>
    <div className="grid g-main"><Skeleton h={320} /><Skeleton h={320} /></div>
  </div>
);

export function Field({ label, hint, children, full }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Drop-in replacement for <select>: same value/onChange/<option> API, custom-styled popup (native select popups can't be themed). */
export function Select({ value, onChange, children, className = '', style, disabled, placeholder, ...rest }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef(null);
  const items = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === 'optgroup') {
      items.push({ group: c.props.label });
      Children.forEach(c.props.children, (o) => isValidElement(o) && items.push({ value: o.props.value, label: o.props.children, disabled: o.props.disabled }));
    } else items.push({ value: c.props.value, label: c.props.children, disabled: c.props.disabled });
  });
  const options = items.filter((o) => !o.group);
  const idx = options.findIndex((o) => String(o.value) === String(value ?? ''));
  const cur = options[idx];

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const choose = (o) => { if (o.disabled) return; setOpen(false); onChange?.({ target: { value: o.value } }); };
  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setHi(idx >= 0 ? idx : 0); return; }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setHi((h) => Math.min(Math.max((h < 0 ? idx : h) + dir, 0), options.length - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) { const o = options[hi >= 0 ? hi : idx]; if (o) choose(o); } else setOpen(true);
    } else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={`select ${className}`} style={{ ...style, position: 'relative' }} ref={box} role="combobox" aria-haspopup="listbox"
      aria-expanded={open} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && setOpen((o) => !o)} onKeyDown={onKeyDown} {...rest}>
      <span className="select-label ellipsis">{cur ? cur.label : placeholder ?? ''}</span>
      {open && (
        <div className="select-list" role="listbox" onClick={(e) => e.stopPropagation()}>
          {(() => { let i = -1; return items.map((o, k) => {
            if (o.group) return <div key={`g${k}`} className="select-group">{o.group}</div>;
            i += 1; const n = i;
            return (
              <div key={o.value ?? k} role="option" aria-selected={n === idx}
                className={`${n === hi ? 'hi' : ''} ${n === idx ? 'on' : ''} ${o.disabled ? 'disabled' : ''}`}
                onMouseEnter={() => setHi(n)} onClick={(e) => { e.stopPropagation(); choose(o); }}>
                <span className="ellipsis">{o.label}</span>
                {n === idx && <Check size={14} className="select-check" />}
              </div>
            );
          }); })()}
        </div>
      )}
    </div>
  );
}

export function ErrorState({ error, retry }) {
  return (
    <div className="card"><Empty title="Something went wrong" action={retry && <button className="btn" onClick={retry}>Try again</button>}>{error?.message}</Empty></div>
  );
}

export function ChartTip({ active, payload, label, fmt = (v) => v }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <b>{label ?? payload[0].name}</b>
      {payload.map((p, i) => (
        <div key={i} className="row small"><span className="swatch" style={{ '--c': p.color || p.payload?.fill }} />{p.name}: <b style={{ display: 'inline', margin: 0 }}>{fmt(p.value, p)}</b></div>
      ))}
    </div>
  );
}

/* ------------------------------------------------ overlays */
function useEscape(fn) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn]);
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, header, children }) {
  useEscape(onClose);
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">{header}</div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
