import { useMemo, useState } from 'react';
import type { Credentials, Release, ReleaseFilter, ReleaseIssue } from '../../shared/types';
import { api } from '../api';
import { daysFromToday, describeDays, formatDate } from '../dates';
import { useAsync } from '../useAsync';
import ErrorBox from './ErrorBox';
import Pagination, { usePagination } from './Pagination';

interface Props {
  creds: Credentials;
  onUnauthorized: () => void;
}

const FILTERS: { id: ReleaseFilter; label: string }[] = [
  { id: 'unreleased', label: 'Unreleased' },
  { id: 'released', label: 'Released' },
  { id: 'all', label: 'All' },
];

type StatusKey = 'released' | 'overdue' | 'unreleased' | 'archived';
const statusOf = (r: Release): StatusKey =>
  r.archived ? 'archived' : r.released ? 'released' : r.overdue ? 'overdue' : 'unreleased';
const STATUS_LABEL: Record<StatusKey, string> = {
  released: 'Released',
  overdue: 'Overdue',
  unreleased: 'Unreleased',
  archived: 'Archived',
};

export default function Releases({ creds, onUnauthorized }: Props) {
  const [selected, setSelected] = useState<Release | null>(null);
  if (selected) {
    return <ReleaseDetail creds={creds} release={selected} onBack={() => setSelected(null)} onUnauthorized={onUnauthorized} />;
  }
  return <ReleaseList creds={creds} onSelect={setSelected} onUnauthorized={onUnauthorized} />;
}

/* ---------- list ---------- */

function ReleaseList({
  creds,
  onSelect,
  onUnauthorized,
}: Props & { onSelect: (r: Release) => void }) {
  const [filter, setFilter] = useState<ReleaseFilter>('unreleased');
  const [project, setProject] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error, reload } = useAsync((s) => api.releases(creds, s), [creds]);

  const projects = useMemo(
    () => [...new Map((data ?? []).map((r) => [r.projectKey, r.projectName])).entries()].sort(),
    [data],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data ?? []).filter(
      (r) =>
        (filter === 'all' || (filter === 'released' ? r.released : !r.released)) &&
        (!project || r.projectKey === project) &&
        (!q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)),
    );
    const dateOf = (r: Release) => r.releaseDate ?? r.startDate ?? '';
    // Upcoming first (soonest, undated last); released newest first.
    return list.sort((a, b) => {
      if (a.released !== b.released) return a.released ? 1 : -1;
      const [da, db] = [dateOf(a), dateOf(b)];
      if (!da || !db) return da ? -1 : db ? 1 : a.name.localeCompare(b.name);
      return a.released ? db.localeCompare(da) : da.localeCompare(db);
    });
  }, [data, filter, project, query]);

  const pager = usePagination(rows);

  return (
    <section>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Release filter">
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
        <input type="search" placeholder="Search releases…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn" onClick={reload} disabled={loading}>Refresh</button>
      </div>

      {error && <ErrorBox error={error} onRetry={reload} onUnauthorized={onUnauthorized} />}
      {loading && !data && <p className="muted">Loading releases from all projects…</p>}

      {data && (
        <div className={`card table-wrap ${loading ? 'stale' : ''}`}>
          <table>
            <thead>
              <tr>
                <th>Release</th>
                <th>Project</th>
                <th>Status</th>
                <th>Start date</th>
                <th>End (release) date</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((r) => (
                <tr key={`${r.projectKey}-${r.id}`} className="clickable" onClick={() => onSelect(r)}>
                  <td className="summary">
                    <button className="link-btn" onClick={(e) => { e.stopPropagation(); onSelect(r); }}>
                      {r.name}
                    </button>
                    {r.description && <div className="muted small clamp">{r.description}</div>}
                  </td>
                  <td className="nowrap"><span className="chip" title={r.projectName}>{r.projectKey}</span></td>
                  <td className="nowrap"><StatusPill release={r} /></td>
                  <td className="nowrap">{r.startDate ? formatDate(r.startDate) : <span className="muted">—</span>}</td>
                  <td className="nowrap">
                    {r.releaseDate ? (
                      <>
                        {formatDate(r.releaseDate)}
                        {!r.released && (
                          <div className={`small ${r.overdue ? 'overdue' : 'muted'}`}>
                            {describeDays(daysFromToday(r.releaseDate))}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">No releases match.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="table-foot">
            <span className="muted small">
              {rows.length} of {data.length} releases across {projects.length} project{projects.length === 1 ? '' : 's'}
            </span>
            <Pagination {...pager} />
          </div>
        </div>
      )}
    </section>
  );
}

function StatusPill({ release }: { release: Release }) {
  const s = statusOf(release);
  const cls = { released: 'done', overdue: 'overdue', unreleased: 'indeterminate', archived: '' }[s];
  return <span className={`status ${cls}`}>{STATUS_LABEL[s]}</span>;
}

/* ---------- detail ---------- */

function ReleaseDetail({
  creds,
  release: r,
  onBack,
  onUnauthorized,
}: Props & { release: Release; onBack: () => void }) {
  const { data, loading, error, reload } = useAsync((s) => api.releaseIssues(creds, r.id, s), [creds, r.id]);

  const counts = useMemo(() => {
    const c = { done: 0, indeterminate: 0, todo: 0 };
    for (const i of data ?? []) {
      if (i.statusCategory === 'done') c.done++;
      else if (i.statusCategory === 'indeterminate') c.indeterminate++;
      else c.todo++;
    }
    return c;
  }, [data]);
  const issuePager = usePagination(data ?? [], 25);
  const total = data?.length ?? 0;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  const span =
    r.startDate && r.releaseDate ? Math.max(daysFromToday(r.releaseDate) - daysFromToday(r.startDate), 0) : null;

  return (
    <section>
      <button className="btn back" onClick={onBack}>← All releases</button>

      <div className="card pad detail-head">
        <div>
          <h1>{r.name}</h1>
          <div className="row wrap">
            <span className="chip" title={r.projectName}>{r.projectKey}</span>
            <span className="muted">{r.projectName}</span>
            <StatusPill release={r} />
          </div>
          {r.description && <p className="detail-desc">{r.description}</p>}
        </div>
        <a className="btn" href={`${creds.site}/projects/${r.projectKey}/versions/${r.id}`} target="_blank" rel="noreferrer">
          Open in Jira ↗
        </a>
      </div>

      <div className="stats">
        <div className="card stat">
          <span className="stat-label">Start date</span>
          <span className="stat-value small-value">{r.startDate ? formatDate(r.startDate) : '—'}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">End (release) date</span>
          <span className="stat-value small-value">{r.releaseDate ? formatDate(r.releaseDate) : '—'}</span>
          {r.releaseDate && !r.released && (
            <span className={`small ${r.overdue ? 'overdue' : 'muted'}`}>{describeDays(daysFromToday(r.releaseDate))}</span>
          )}
        </div>
        <div className="card stat">
          <span className="stat-label">Duration</span>
          <span className="stat-value small-value">{span === null ? '—' : `${span} day${span === 1 ? '' : 's'}`}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Issues</span>
          <span className="stat-value small-value">{data ? total : '…'}</span>
          {data && total > 0 && <span className="muted small">{counts.done} done</span>}
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={reload} onUnauthorized={onUnauthorized} />}
      {loading && !data && <p className="muted">Loading issues…</p>}

      {data && (
        <>
          {total > 0 && (
            <div className="card pad">
              <h2>Progress</h2>
              <div className="progress" role="img" aria-label={`${counts.done} done, ${counts.indeterminate} in progress, ${counts.todo} to do`}>
                <div className="seg done" style={{ width: `${pct(counts.done)}%` }} />
                <div className="seg doing" style={{ width: `${pct(counts.indeterminate)}%` }} />
              </div>
              <div className="legend small">
                <span><i className="dot done" /> Done {counts.done} ({Math.round(pct(counts.done))}%)</span>
                <span><i className="dot doing" /> In progress {counts.indeterminate}</span>
                <span><i className="dot todo" /> To do {counts.todo}</span>
              </div>
            </div>
          )}

          <div className="section-head"><h2>Issues in this release</h2></div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {issuePager.slice.map((i) => <IssueRow key={i.key} issue={i} site={creds.site} />)}
                {data.length === 0 && (
                  <tr><td colSpan={5} className="empty">No issues have this release as a Fix Version.</td></tr>
                )}
              </tbody>
            </table>
            {total > 0 && (
              <div className="table-foot">
                <span />
                <Pagination {...issuePager} />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function IssueRow({ issue: i, site }: { issue: ReleaseIssue; site: string }) {
  return (
    <tr>
      <td className="nowrap">
        <a className="key" href={`${site}/browse/${i.key}`} target="_blank" rel="noreferrer">{i.key}</a>
      </td>
      <td className="summary"><span className="type">{i.issueType}</span> {i.summary}</td>
      <td className="nowrap"><span className={`status ${i.statusCategory}`}>{i.status}</span></td>
      <td className="nowrap">{i.assignee ?? <span className="muted">Unassigned</span>}</td>
      <td className="nowrap muted">{i.priority ?? '—'}</td>
    </tr>
  );
}
