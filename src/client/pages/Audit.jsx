import { useState } from 'react';
import { ScrollText, FolderKanban, ListChecks, Clock, UserCog, Shield } from 'lucide-react';
import { api, qs } from '../api';
import { Avatar, Empty, ErrorState, Skeleton, useFetch } from '../ui';
import { ago } from '../format';

const GROUPS = { '': 'Everything', project: 'Projects', task: 'Tasks', subtask: 'Subtasks', time: 'Time entries', user: 'Users' };
const ICON = { project: FolderKanban, task: ListChecks, subtask: ListChecks, time: Clock, user: UserCog };
const COLOR = { project: 'var(--primary-2)', task: 'var(--primary)', subtask: 'var(--info)', time: 'var(--success)', user: 'var(--warn)' };

export default function Audit() {
  const [g, setG] = useState('');
  const { data, error, reload } = useFetch(() => api.get(`/audit${qs({ action: g })}`), [g]);
  if (error && !data) return <div className="page"><ErrorState error={error} retry={reload} /></div>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Audit log</h1><p>Sensitive and important changes, who made them, and when. Most recent 200 events.</p></div></div>
      <div className="pills" style={{ marginBottom: 18 }}>{Object.entries(GROUPS).map(([k, v]) => <button key={k} className={g === k ? 'on' : ''} onClick={() => setG(k)}>{v}</button>)}</div>
      {!data ? <Skeleton h={320} /> : data.length === 0 ? <div className="card"><Empty icon={ScrollText} title="No events recorded">Activity will appear here as people use the app.</Empty></div> : (
        <div className="card" style={{ padding: '10px 8px' }}>
          {data.map((e) => {
            const key = e.action.split('.')[0];
            const Icon = ICON[key] || Shield;
            return (
              <div key={e.id} className="task-row" style={{ cursor: 'default' }}>
                <span className="avatar" style={{ '--s': '36px', '--c': `color-mix(in srgb, ${COLOR[key] || 'var(--text-3)'} 22%, transparent)`, color: COLOR[key] || 'var(--text-3)', boxShadow: 'none' }}><Icon size={16} /></span>
                <div className="grow"><div style={{ fontWeight: 600 }}>{e.summary}</div>
                  <div className="xs faint row" style={{ gap: 8, marginTop: 2 }}><Avatar user={e.actor} size={16} />{e.actor?.name || 'System'}<span className="chip">{e.action}</span>{e.meta?.reason && <span className="muted">Reason: {e.meta.reason}</span>}</div></div>
                <span className="xs faint" title={new Date(e.createdAt).toLocaleString()}>{ago(e.createdAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
