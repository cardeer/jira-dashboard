import { useMemo, useState } from 'react';
import type { Credentials, Task, TaskFilter } from '../../shared/types';
import { api } from '../api';
import { relativeTime, formatDay } from '../dates';
import { useAsync } from '../useAsync';
import ErrorBox from './ErrorBox';

interface Props {
  creds: Credentials;
  onUnauthorized: () => void;
}

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done (30 days)' },
  { id: 'all', label: 'All' },
];

export default function Tasks({ creds, onUnauthorized }: Props) {
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const { data, loading, error, reload } = useAsync((s) => api.tasks(creds, filter, s), [creds, filter]);

  const projects = useMemo(
    () => [...new Map((data ?? []).map((t) => [t.projectKey, t.projectName])).entries()].sort(),
    [data],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      (t) =>
        (!project || t.projectKey === project) &&
        (!q || t.key.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q)),
    );
  }, [data, query, project]);

  return (
    <section>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Task filter">
          {FILTERS.map((f) => (
            <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects.map(([key, name]) => (
            <option key={key} value={key}>{name} ({key})</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search key or summary…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" onClick={reload} disabled={loading}>Refresh</button>
      </div>

      {error && <ErrorBox error={error} onRetry={reload} onUnauthorized={onUnauthorized} />}
      {loading && !data && <p className="muted">Loading tasks…</p>}

      {data && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Project</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Due</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <TaskRow key={t.key} task={t} site={creds.site} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">No tasks match.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="table-foot muted small">
            {rows.length} of {data.length} tasks assigned to you
          </div>
        </div>
      )}
    </section>
  );
}

function TaskRow({ task: t, site }: { task: Task; site: string }) {
  const overdue = t.dueDate && t.statusCategory !== 'done' && t.dueDate < new Date().toISOString().slice(0, 10);
  return (
    <tr>
      <td className="nowrap">
        <a href={`${site}/browse/${t.key}`} target="_blank" rel="noreferrer" className="key">{t.key}</a>
      </td>
      <td className="summary">
        <span className="type">{t.issueType}</span> {t.summary}
      </td>
      <td className="nowrap"><span className="chip">{t.projectKey}</span></td>
      <td className="nowrap"><span className={`status ${t.statusCategory}`}>{t.status}</span></td>
      <td className="nowrap muted">{t.priority ?? '—'}</td>
      <td className={`nowrap ${overdue ? 'overdue' : 'muted'}`}>
        {t.dueDate ? formatDay(t.dueDate, { weekday: undefined }) : '—'}
      </td>
      <td className="nowrap muted">{relativeTime(t.updated)}</td>
    </tr>
  );
}
