import { Fragment, useMemo, useState } from 'react';
import type { Credentials, WorklogEntry } from '../../shared/types';
import { api } from '../api';
import { PRESETS, eachDay, formatDay, formatDuration, formatHours, fromISO, isWeekend, presetRange, timeRange, type Preset } from '../dates';
import { useAsync } from '../useAsync';
import ErrorBox from './ErrorBox';

interface Props {
  creds: Credentials;
  onUnauthorized: () => void;
}

type GroupBy = 'task' | 'day';
const DAY_TARGET = 8 * 3600;

export default function Worklogs({ creds, onUnauthorized }: Props) {
  const [preset, setPreset] = useState<Preset | 'custom'>('this-week');
  const [range, setRange] = useState(() => presetRange('this-week'));
  const [groupBy, setGroupBy] = useState<GroupBy>('day');

  const { data, loading, error, reload } = useAsync(
    (s) => api.worklogs(creds, range.from, range.to, s),
    [creds, range.from, range.to],
  );

  const stats = useMemo(() => summarize(data ?? [], range.from, range.to), [data, range]);

  function pick(p: Preset) {
    setPreset(p);
    setRange(presetRange(p));
  }
  function setCustom(patch: Partial<typeof range>) {
    const next = { ...range, ...patch };
    if (next.from && next.to && next.from <= next.to) {
      setPreset('custom');
      setRange(next);
    }
  }

  return (
    <section>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button key={p.id} aria-pressed={preset === p.id} onClick={() => pick(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="dates">
          <input type="date" value={range.from} max={range.to} onChange={(e) => setCustom({ from: e.target.value })} aria-label="From" />
          <span className="muted">→</span>
          <input type="date" value={range.to} min={range.from} onChange={(e) => setCustom({ to: e.target.value })} aria-label="To" />
        </div>
        <button className="btn" onClick={reload} disabled={loading}>Refresh</button>
      </div>

      {error && <ErrorBox error={error} onRetry={reload} onUnauthorized={onUnauthorized} />}
      {loading && !data && <p className="muted">Loading work logs across all projects…</p>}

      {data && (
        <div className={loading ? 'stale' : undefined}>
          <div className="stats">
            <Stat label="Total logged" value={formatDuration(stats.total)} />
            <Stat label="Days with logs" value={`${stats.daysLogged}`} sub={`of ${stats.days} in range`} />
            <Stat label="Avg per logged day" value={stats.daysLogged ? formatDuration(stats.total / stats.daysLogged) : '—'} />
            <Stat label="Tasks worked on" value={`${stats.byTask.length}`} sub={`${stats.byProject.length} project${stats.byProject.length === 1 ? '' : 's'}`} />
          </div>

          <div className="grid-2">
            <div className="card pad">
              <h2>Hours per day</h2>
              <DayChart perDay={stats.perDay} />
            </div>
            <div className="card pad">
              <h2>By project / team</h2>
              <ProjectBars projects={stats.byProject} total={stats.total} />
            </div>
          </div>

          <div className="section-head">
            <h2>Logged work</h2>
            <div className="segmented" role="group" aria-label="Group by">
              <button aria-pressed={groupBy === 'task'} onClick={() => setGroupBy('task')}>By task</button>
              <button aria-pressed={groupBy === 'day'} onClick={() => setGroupBy('day')}>By day</button>
            </div>
          </div>

          {data.length === 0 ? (
            <div className="card pad empty">No work logged in this period.</div>
          ) : groupBy === 'task' ? (
            <ByTask groups={stats.byTask} site={creds.site} total={stats.total} />
          ) : (
            <ByDay entries={data} site={creds.site} />
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- aggregation ---------- */

interface TaskGroup {
  key: string;
  summary: string;
  projectKey: string;
  projectName: string;
  status: string;
  seconds: number;
  entries: WorklogEntry[];
}

function summarize(entries: WorklogEntry[], from: string, to: string) {
  const perDay = new Map<string, number>(eachDay(from, to).map((d) => [d, 0]));
  const tasks = new Map<string, TaskGroup>();
  const projects = new Map<string, { key: string; name: string; seconds: number }>();
  let total = 0;

  for (const e of entries) {
    total += e.timeSpentSeconds;
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.timeSpentSeconds);
    const t = tasks.get(e.issueKey) ?? {
      key: e.issueKey, summary: e.summary, projectKey: e.projectKey, projectName: e.projectName,
      status: e.status, seconds: 0, entries: [],
    };
    t.seconds += e.timeSpentSeconds;
    t.entries.push(e);
    tasks.set(e.issueKey, t);
    const p = projects.get(e.projectKey) ?? { key: e.projectKey, name: e.projectName, seconds: 0 };
    p.seconds += e.timeSpentSeconds;
    projects.set(e.projectKey, p);
  }

  return {
    total,
    days: perDay.size,
    daysLogged: [...perDay.values()].filter((s) => s > 0).length,
    perDay: [...perDay.entries()],
    byTask: [...tasks.values()].sort((a, b) => b.seconds - a.seconds),
    byProject: [...projects.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

/* ---------- pieces ---------- */

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

function DayChart({ perDay }: { perDay: [string, number][] }) {
  const max = Math.max(DAY_TARGET, ...perDay.map(([, s]) => s));
  const dense = perDay.length > 14;
  return (
    <div className="chart" role="img" aria-label="Hours logged per day">
      <div className="plot">
        <div className="target" style={{ bottom: `${(DAY_TARGET / max) * 100}%` }}><span>8h</span></div>
        {perDay.map(([day, secs]) => (
          <div key={day} className={`col ${isWeekend(day) ? 'weekend' : ''}`} title={`${formatDay(day, { year: 'numeric' })}: ${formatDuration(secs)}`}>
            {secs > 0 && !dense && <span className="bar-val">{formatHours(secs)}</span>}
            <div className="bar" style={{ height: `${(secs / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="labels">
        {perDay.map(([day]) => (
          <span key={day} className={isWeekend(day) ? 'weekend' : ''}>
            {dense ? fromISO(day).getDate() : formatDay(day, { day: undefined, month: undefined })}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProjectBars({ projects, total }: { projects: { key: string; name: string; seconds: number }[]; total: number }) {
  if (projects.length === 0) return <p className="muted">Nothing logged.</p>;
  return (
    <ul className="hbars">
      {projects.map((p) => (
        <li key={p.key}>
          <div className="hbar-head">
            <span><span className="chip">{p.key}</span> {p.name}</span>
            <span className="muted">{formatDuration(p.seconds)} · {Math.round((p.seconds / total) * 100)}%</span>
          </div>
          <div className="hbar"><div style={{ width: `${(p.seconds / total) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function IssueLink({ site, issueKey }: { site: string; issueKey: string }) {
  return <a className="key" href={`${site}/browse/${issueKey}`} target="_blank" rel="noreferrer">{issueKey}</a>;
}

function ByTask({ groups, site, total }: { groups: TaskGroup[]; site: string; total: number }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(k)) n.add(k);
      return n;
    });

  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            <th aria-label="Expand" />
            <th>Task</th>
            <th>Project</th>
            <th>Status</th>
            <th className="num">Entries</th>
            <th className="num">Time</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = open.has(g.key);
            return (
              <Fragment key={g.key}>
                <tr className="clickable" onClick={() => toggle(g.key)}>
                  <td className="caret">
                    <button className="icon-btn" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${g.key}`}>
                      {isOpen ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className="summary">
                    <span onClick={(e) => e.stopPropagation()}><IssueLink site={site} issueKey={g.key} /></span> {g.summary}
                  </td>
                  <td className="nowrap"><span className="chip" title={g.projectName}>{g.projectKey}</span></td>
                  <td className="nowrap muted">{g.status}</td>
                  <td className="num muted">{g.entries.length}</td>
                  <td className="num"><strong>{formatDuration(g.seconds)}</strong></td>
                  <td className="num muted">{Math.round((g.seconds / total) * 100)}%</td>
                </tr>
                {isOpen &&
                  g.entries.map((e) => (
                    <tr key={e.id} className="sub">
                      <td />
                      <td colSpan={3}>
                        <span className="muted">{formatDay(e.date)}</span> <TimeRange entry={e} />
                        {e.comment && <span className="comment"> — {e.comment}</span>}
                      </td>
                      <td />
                      <td className="num">{formatDuration(e.timeSpentSeconds)}</td>
                      <td />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TimeRange({ entry }: { entry: WorklogEntry }) {
  const r = timeRange(entry.started, entry.timeSpentSeconds);
  return (
    <span className="time-range" title={`Logged from ${r.from} to ${r.to}${r.nextDay ? ' (next day)' : ''}`}>
      {r.from} – {r.to}
      {r.nextDay && <sup>+1</sup>}
    </span>
  );
}

function ByDay({ entries, site }: { entries: WorklogEntry[]; site: string }) {
  const days = useMemo(() => {
    const m = new Map<string, WorklogEntry[]>();
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    // Newest day first; within a day, earliest entry first so the from–to times read in order.
    for (const list of m.values()) list.sort((a, b) => (a.started < b.started ? -1 : 1));
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  return (
    <div className="days">
      {days.map(([day, list]) => {
        const secs = list.reduce((s, e) => s + e.timeSpentSeconds, 0);
        return (
          <div className="card day" key={day}>
            <div className="day-head">
              <strong>{formatDay(day, { year: 'numeric' })}</strong>
              <span className={secs >= DAY_TARGET ? 'ok' : 'muted'}>{formatDuration(secs)}</span>
            </div>
            <ul>
              {list.map((e) => (
                <li key={e.id}>
                  <div className="entry-main">
                    <IssueLink site={site} issueKey={e.issueKey} />
                    <span className="entry-title">{e.summary}</span>
                    <span className="chip" title={e.projectName}>{e.projectKey}</span>
                  </div>
                  <TimeRange entry={e} />
                  {e.comment && <div className="comment muted">{e.comment}</div>}
                  <span className="entry-time">{formatDuration(e.timeSpentSeconds)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
