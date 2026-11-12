import { useEffect, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import { busyStore } from './api';

/** Blocks the whole screen while a change is being saved or sent to Trello, so nothing else can be done until it finishes. */
export default function BusyOverlay() {
  const label = useSyncExternalStore(busyStore.subscribe, busyStore.get, () => '');
  useEffect(() => {
    if (!label) return undefined;
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener('keydown', stop, true); // no shortcuts, Enter or Escape while saving
    const active = document.activeElement;
    active?.blur?.();
    return () => window.removeEventListener('keydown', stop, true);
  }, [label]);
  if (!label) return null;
  return (
    <div role="alert" aria-busy="true" aria-live="assertive"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5, 6, 14, 0.45)', backdropFilter: 'blur(2px)', display: 'grid', placeItems: 'center', cursor: 'progress' }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderRadius: 14 }}>
        <Loader2 size={20} className="spin" />
        <div><b>{label}</b><div className="xs faint">Please wait, this can take a few seconds.</div></div>
      </div>
    </div>
  );
}
