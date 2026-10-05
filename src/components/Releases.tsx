import { useEffect, useMemo, useState } from 'react';
import type { Credentials, Release, ReleaseFilter, ReleaseIssue } from '../../shared/types';
import { api, type ReleaseOrder } from '../api';
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

const PROJECT_KEY = 'jira-dashboard.releaseProject';
const SORTS: { id: ReleaseOrder; label: string }[] = [
  { id: 'releaseDate', label: 'Release date: soonest first' },
  { id: '-releaseDate', label: 'Release date: latest first' },
  { id: 'startDate', label: 'Start date: oldest first' },
  { id: '-startDate', label: 'Start date: newest first' },
  { id: 'name', label: 'Name A–Z' },
];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ReleaseList({
  creds,
  onSelect,
  onUnauthorized,
}: Props & { onSelect: (r: Release) => void }) {
  const [filter, setFilter] = useState<ReleaseFilter>('unreleased');
  const [projectKey, setProjectKey] = useState(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [query, setQuery] = useState('');
  const [sortChoice, setSortChoice] = useState<ReleaseOrder | null>(null);
  const [size, setSize] = useState(25);
  const dq = useDebounced(query, 350);

  const projectsReq = useAsync((s) => api.projects(creds, s), [creds]);
  const project = useMemo(() => {
    const list = projectsReq.data ?? [];
    return list.find((p) => p.key === projectKey) ?? list[0] ?? null;
  }, [projectsReq.data, projectKey]);

  const orderBy: ReleaseOrder = sortChoice ?? (filter === 'unreleased' ? 'releaseDate' : '-releaseDate');

  // The page number belongs to one set of filters; any change to them starts again at page 1.
  const filterKey = JSON.stringify([project?.key, filter, dq, orderBy, size]);
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });

  const releasesReq = useAsync(
    (s) =>
      project
        ? api.releasePage(creds, { project, status: filter, query: dq, orderBy, page, pageSize: size }, s)
        : Promise.resolve(null),
    [creds, project?.key, filter, dq, orderBy, page, size],
  );

  function chooseProject(key: string) {
    setProjectKey(key);
    try {
      localStorage.setItem(PROJECT_KEY, key);
    } catch {
      /* not remembered */
    }
  }

  const error = projectsReq.error ?? releasesReq.error;
  const reload = projectsReq.error ? projectsReq.reload : releasesReq.reload;
  const result = releasesReq.data;
  const total = result?.total ?? 0;

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
        <select
          value={project?.key ?? ''}
          onChange={(e) => chooseProject(e.target.value)}
          aria-label="Project"
          disabled={!projectsReq.data}
        >
          {(projectsReq.data ?? []).map((p) => (
            <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
          ))}
        </select>
        <select value={orderBy} onChange={(e) => setSortChoice(e.target.value as ReleaseOrder)} aria-label="Sort">
          {SORTS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <input type="search" placeholder="Search releases…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn" onClick={reload} disabled={releasesReq.loading}>Refresh</button>
      </div>

      {error && <ErrorBox error={error} onRetry={reload} onUnauthorized={onUnauthorized} />}
      {!error && !result && <p className="muted">{projectsReq.data && !project ? 'No projects found.' : 'Loading releases…'}</p>}

      {result && (
        <div className={`card table-wrap ${releasesReq.loading ? 'stale' : ''}`}>
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
              {result.releases.map((r) => (
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
              {result.releases.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">No releases match.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="table-foot">
            <span className="muted small">{project?.name}</span>
            <Pagination
              page={page}
              pages={Math.max(1, Math.ceil(total / size))}
              size={size}
              total={total}
              setPage={setPage}
              setSize={setSize}
            />
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
