import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { WorklogEntry } from '../../shared/types';
import { useHoverTip } from './HoverTip';
import { eachDay, formatDay, fromISO, isWeekend, timeRange, toISO } from '../dates';

interface Props {
  entries: WorklogEntry[];
  from: string;
  to: string;
  site: string;
}

const DAY_TARGET_H = 8;
const LOW_H = 6;

/** 6.75, 3.5, 8 — hours with up to two decimals, like Jira's timesheet reports. */
const hours = (seconds: number) => String(Math.round((seconds / 3600) * 100) / 100);

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
function isoWeek(iso: string): number {
  const d = fromISO(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

/** Under / on / over the daily target, shown as a coloured underline on totals. */
const load = (seconds: number) => {
  const h = seconds / 3600;
  if (h === 0) return '';
  if (h > DAY_TARGET_H) return 'over';
  if (h >= LOW_H) return 'ok';
  return 'low';
};

interface TaskRow {
  key: string;
  summary: string;
  issueType: string;
  perDay: Map<string, WorklogEntry[]>;
  total: number;
}

interface ProjectGroup {
  key: string;
  name: string;
  tasks: TaskRow[];
  perDay: Map<string, number>;
  total: number;
}

export default function Timesheet({ entries, from, to, site }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const today = toISO(new Date());
  const { bind, tip } = useHoverTip();

  const days = useMemo(() => eachDay(from, to), [from, to]);

  // Consecutive days grouped into ISO weeks for the top header row.
  const weeks = useMemo(() => {
    const out: { label: string; days: string[] }[] = [];
    for (const d of days) {
      const last = out[out.length - 1];
      if (last && fromISO(d).getDay() !== 1) last.days.push(d);
      else out.push({ label: '', days: [d] });
    }
    for (const w of out) {
      const first = fromISO(w.days[0]);
      const lastDay = fromISO(w.days[w.days.length - 1]);
      const month = first.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }).toUpperCase();
      w.label = `${month}, ${first.getDate()} to ${lastDay.getDate()} (W-${isoWeek(w.days[0])})`;
    }
    return out;
  }, [days]);
  const multiWeek = weeks.length > 1;

  const { groups, dayTotals, grandTotal } = useMemo(() => {
    const projects = new Map<string, ProjectGroup>();
    const dayTotals = new Map<string, number>();
    let grandTotal = 0;
    for (const e of entries) {
      const p: ProjectGroup = projects.get(e.projectKey) ?? {
        key: e.projectKey,
        name: e.projectName,
        tasks: [],
        perDay: new Map(),
        total: 0,
      };
      projects.set(e.projectKey, p);
      let t = p.tasks.find((x) => x.key === e.issueKey);
      if (!t) {
        t = { key: e.issueKey, summary: e.summary, issueType: e.issueType, perDay: new Map(), total: 0 };
        p.tasks.push(t);
      }
      t.perDay.set(e.date, [...(t.perDay.get(e.date) ?? []), e]);
      t.total += e.timeSpentSeconds;
      p.perDay.set(e.date, (p.perDay.get(e.date) ?? 0) + e.timeSpentSeconds);
      p.total += e.timeSpentSeconds;
      dayTotals.set(e.date, (dayTotals.get(e.date) ?? 0) + e.timeSpentSeconds);
      grandTotal += e.timeSpentSeconds;
    }
    const groups = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const g of groups) g.tasks.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
    return { groups, dayTotals, grandTotal };
  }, [entries]);

  const weekTotal = (perDay: (d: string) => number, w: { days: string[] }) =>
    w.days.reduce((s, d) => s + perDay(d), 0);

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (!n.delete(key)) n.add(key);
      return n;
    });

  const dayClass = (d: string) =>
    ['day-col', isWeekend(d) ? 'weekend' : '', d === today ? 'today' : ''].filter(Boolean).join(' ');

  /** Renders one row's day cells (+ week subtotals) from a seconds-per-day lookup. */
  const cells = (perDay: (d: string) => number, opts: { underline?: boolean; tip?: (d: string) => ReactNode } = {}) =>
    weeks.map((w) => (
      <Fragment key={w.days[0]}>
        {w.days.map((d) => {
          const s = perDay(d);
          return (
            <td
              key={d}
              className={`${dayClass(d)} ${s && opts.tip ? 'has-tip' : ''}`}
              {...(s && opts.tip ? { tabIndex: 0, ...bind(() => opts.tip!(d)) } : {})}
            >
              {s > 0 && <span className={opts.underline ? `load ${load(s)}` : undefined}>{hours(s)}</span>}
            </td>
          );
        })}
        {multiWeek && <td className="week-total">{weekTotal(perDay, w) > 0 && hours(weekTotal(perDay, w))}</td>}
      </Fragment>
    ));

  if (entries.length === 0) return <div className="card pad empty">No work logged in this period.</div>;

  return (
    <div className="card sheet-wrap">
      <table className="sheet">
        <thead>
          <tr>
            <th rowSpan={2} className="task-col">Task</th>
            {weeks.map((w) => (
              <th key={w.days[0]} colSpan={w.days.length + (multiWeek ? 1 : 0)} className="week-head">
                {w.label}
              </th>
            ))}
            <th rowSpan={2} className="total-col">Total</th>
          </tr>
          <tr>
            {weeks.map((w) => (
              <Fragment key={w.days[0]}>
                {w.days.map((d) => (
                  <th key={d} className={dayClass(d)}>
                    <span className="day-num">{fromISO(d).getDate()}</span>
                    <span className="day-name">{formatDay(d, { day: undefined, month: undefined }).slice(0, 2).toUpperCase()}</span>
                  </th>
                ))}
                {multiWeek && <th className="week-total">Week</th>}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = !collapsed.has(g.key);
            return (
              <Fragment key={g.key}>
                <tr className="group-row" onClick={() => toggle(g.key)}>
                  <td className="task-col">
                    <button className="icon-btn" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${g.name}`}>
                      {isOpen ? '▾' : '▸'}
                    </button>{' '}
                    <span className="chip">{g.key}</span> {g.name}
                  </td>
                  {cells((d) => g.perDay.get(d) ?? 0)}
                  <td className="total-col">{hours(g.total)}</td>
                </tr>
                {isOpen &&
                  g.tasks.map((t) => (
                    <tr key={t.key}>
                      <td
                        className="task-col"
                        {...bind(() => (
                          <div className="tip-title"><b>{t.key}</b> {t.summary}</div>
                        ))}
                      >
                        <a className="key" href={`${site}/browse/${t.key}`} target="_blank" rel="noreferrer">{t.key}</a>
                        <span className="task-summary">{t.summary}</span>
                      </td>
                      {cells(
                        (d) => (t.perDay.get(d) ?? []).reduce((s, e) => s + e.timeSpentSeconds, 0),
                        {
                          tip: (d) => <EntryTip task={t} day={d} />,
                        },
                      )}
                      <td className="total-col">{hours(t.total)}</td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="task-col">Total →</td>
            {cells((d) => dayTotals.get(d) ?? 0, { underline: true })}
            <td className="total-col">{hours(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
      {tip}
      <div className="sheet-legend small muted">
        Daily totals: <span className="load low">under {LOW_H}h</span> <span className="load ok">{LOW_H}–{DAY_TARGET_H}h</span>{' '}
        <span className="load over">over {DAY_TARGET_H}h</span> · hover a cell for times and comments
      </div>
    </div>
  );
}

function EntryTip({ task, day }: { task: TaskRow; day: string }) {
  const list = [...(task.perDay.get(day) ?? [])].sort((a, b) => (a.started < b.started ? -1 : 1));
  const total = list.reduce((s, e) => s + e.timeSpentSeconds, 0);
  return (
    <>
      <div className="tip-head">
        <span><b>{task.key}</b> · {formatDay(day)}</span>
        <strong>{hours(total)}h</strong>
      </div>
      {list.map((e) => {
        const r = timeRange(e.started, e.timeSpentSeconds);
        return (
          <div key={e.id} className="tip-entry">
            <div className="tip-row">
              <span className="tip-time">
                {r.from} – {r.to}
                {r.nextDay && <sup>+1</sup>}
              </span>
              <span>{hours(e.timeSpentSeconds)}h</span>
            </div>
            {e.comment && <div className="tip-comment">{e.comment}</div>}
          </div>
        );
      })}
    </>
  );
}
