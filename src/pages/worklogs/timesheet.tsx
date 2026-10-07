import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { eachDay, formatDay, fromISO, isWeekend, timeRange, toISO } from '@/dates';
import { cn } from '@/lib/utils';
import type { WorklogEntry } from '../../../shared/types';
import { PersonAvatar } from '@/components/person-avatar';
import { hours } from './aggregate';

const DAY_TARGET_H = 8;
const LOW_H = 6;

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
function isoWeek(iso: string): number {
  const d = fromISO(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

/** Coloured underline on daily totals: under / within / over the daily target. */
function loadClass(seconds: number) {
  const h = seconds / 3600;
  if (h === 0) return '';
  if (h > DAY_TARGET_H) return 'border-red-500';
  if (h >= LOW_H) return 'border-emerald-500';
  return 'border-amber-500';
}

interface TaskRow {
  key: string;
  summary: string;
  perDay: Map<string, WorklogEntry[]>;
  total: number;
}
/** A row group: a project (your logs) or a person (all members). */
interface ProjectGroup {
  key: string;
  name: string;
  avatar?: string;
  tasks: TaskRow[];
  perDay: Map<string, number>;
  total: number;
}

// Shared cell styles. Sticky cells need an opaque background so content scrolls underneath.
const cellBase = 'border-r border-b px-2 py-1.5 align-middle';
const dayCell = 'w-12 min-w-12 text-center tabular-nums';
const stickyLeft = 'sticky left-0 z-10 w-80 min-w-80 max-w-80 truncate bg-card text-left';
const stickyRight = 'sticky right-0 z-10 w-16 min-w-16 bg-muted text-center font-semibold tabular-nums shadow-[-1px_0_0_var(--border)]';
const weekendBg =
  'bg-muted/50 bg-[repeating-linear-gradient(45deg,transparent_0_6px,color-mix(in_oklab,var(--border)_80%,transparent)_6px_7px)]';

interface Props {
  entries: WorklogEntry[];
  from: string;
  to: string;
  site: string;
  /** 'project' for one person's logs; 'person' (person → tasks) when viewing all members. */
  groupBy?: 'project' | 'person';
}

export function Timesheet({ entries, from, to, site, groupBy = 'project' }: Props) {
  const byPerson = groupBy === 'person';
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const today = toISO(new Date());
  const days = useMemo(() => eachDay(from, to), [from, to]);

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
      const groupKey = byPerson ? e.authorId : e.projectKey;
      const p: ProjectGroup = projects.get(groupKey) ?? {
        key: groupKey,
        name: byPerson ? e.authorName : e.projectName,
        avatar: byPerson ? e.authorAvatar : undefined,
        tasks: [],
        perDay: new Map(),
        total: 0,
      };
      projects.set(groupKey, p);
      let t = p.tasks.find((x) => x.key === e.issueKey);
      if (!t) {
        t = { key: e.issueKey, summary: e.summary, perDay: new Map(), total: 0 };
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
  }, [entries, byPerson]);

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (!n.delete(key)) n.add(key);
      return n;
    });

  const dayBg = (d: string) => cn(isWeekend(d) && weekendBg, d === today && 'bg-primary/5');

  /** One row's day cells plus week subtotals. */
  const cells = (
    perDay: (d: string) => number,
    opts: { underline?: boolean; tip?: (d: string) => ReactNode; rowBg?: string } = {},
  ) =>
    weeks.map((w) => {
      const wk = w.days.reduce((s, d) => s + perDay(d), 0);
      return (
        <Fragment key={w.days[0]}>
          {w.days.map((d) => {
            const s = perDay(d);
            const content = s > 0 && (
              <span className={cn(opts.underline && 'inline-block border-b-[3px] pb-px', opts.underline && loadClass(s))}>
                {hours(s)}
              </span>
            );
            const className = cn(cellBase, dayCell, opts.rowBg, dayBg(d));
            if (s > 0 && opts.tip) {
              return (
                <Tooltip key={d}>
                  <TooltipTrigger asChild>
                    <td
                      tabIndex={0}
                      className={cn(className, 'cursor-default outline-none hover:ring-2 hover:ring-primary hover:ring-inset focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset')}
                    >
                      {content}
                    </td>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="block max-w-xs">
                    {opts.tip(d)}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return <td key={d} className={className}>{content}</td>;
          })}
          {multiWeek && (
            <td className={cn(cellBase, 'min-w-14 bg-muted/60 text-center font-semibold tabular-nums')}>{wk > 0 && hours(wk)}</td>
          )}
        </Fragment>
      );
    });

  if (entries.length === 0) {
    return <Card className="p-10 text-center text-sm text-muted-foreground">No work logged in this period.</Card>;
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="max-h-[calc(100svh-15rem)] overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th rowSpan={2} className={cn(cellBase, stickyLeft, 'top-0 z-30 font-medium text-muted-foreground')}>Task</th>
              {weeks.map((w) => (
                <th
                  key={w.days[0]}
                  colSpan={w.days.length + (multiWeek ? 1 : 0)}
                  className={cn(cellBase, 'sticky top-0 z-20 h-9 bg-card text-center text-xs font-semibold whitespace-nowrap text-primary')}
                >
                  {w.label}
                </th>
              ))}
              <th rowSpan={2} className={cn(cellBase, stickyRight, 'top-0 z-30 text-xs text-muted-foreground')}>Total</th>
            </tr>
            <tr>
              {weeks.map((w) => (
                <Fragment key={w.days[0]}>
                  {w.days.map((d) => (
                    <th
                      key={d}
                      className={cn(
                        cellBase,
                        dayCell,
                        'sticky top-9 z-20 bg-card leading-tight',
                        d === today && 'bg-accent',
                        isWeekend(d) && 'text-red-500',
                      )}
                    >
                      <span className={cn('block text-sm font-semibold', d === today && 'text-primary')}>{fromISO(d).getDate()}</span>
                      <span className={cn('block text-[10px] font-medium tracking-wide', !isWeekend(d) && 'text-muted-foreground')}>
                        {formatDay(d, { day: undefined, month: undefined }).slice(0, 2).toUpperCase()}
                      </span>
                    </th>
                  ))}
                  {multiWeek && (
                    <th className={cn(cellBase, 'sticky top-9 z-20 bg-muted text-xs font-medium text-muted-foreground')}>Week</th>
                  )}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const open = !collapsed.has(g.key);
              return (
                <Fragment key={g.key}>
                  <tr className="cursor-pointer font-semibold" onClick={() => toggle(g.key)}>
                    <td className={cn(cellBase, stickyLeft, 'bg-muted')}>
                      <span className="inline-flex items-center gap-1.5">
                        {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                        {byPerson ? (
                          <PersonAvatar person={{ displayName: g.name, avatarUrl: g.avatar }} className="size-5" />
                        ) : (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{g.key}</span>
                        )}
                        {g.name}
                      </span>
                    </td>
                    {cells((d) => g.perDay.get(d) ?? 0, { rowBg: 'bg-muted', underline: byPerson })}
                    <td className={cn(cellBase, stickyRight)}>{hours(g.total)}</td>
                  </tr>
                  {open &&
                    g.tasks.map((t) => (
                      <tr key={t.key} className="group">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <td className={cn(cellBase, stickyLeft, 'group-hover:bg-accent')}>
                              <a href={`${site}/browse/${t.key}`} target="_blank" rel="noreferrer" className="font-medium text-link hover:underline">
                                {t.key}
                              </a>
                              <span className="ml-1.5">{t.summary}</span>
                            </td>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-sm">
                            <b>{t.key}</b> {t.summary}
                          </TooltipContent>
                        </Tooltip>
                        {cells((d) => (t.perDay.get(d) ?? []).reduce((s, e) => s + e.timeSpentSeconds, 0), {
                          tip: (d) => <EntryTip task={t} day={d} />,
                        })}
                        <td className={cn(cellBase, stickyRight)}>{hours(t.total)}</td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className={cn(cellBase, stickyLeft, 'bottom-0 z-20 border-t-2 text-right')}>Total →</td>
              {weeks.map((w) => {
                const wk = w.days.reduce((s, d) => s + (dayTotals.get(d) ?? 0), 0);
                return (
                  <Fragment key={w.days[0]}>
                    {w.days.map((d) => {
                      const s = dayTotals.get(d) ?? 0;
                      return (
                        <td key={d} className={cn(cellBase, dayCell, 'sticky bottom-0 z-10 border-t-2 bg-card', d === today && 'bg-accent')}>
                          {s > 0 && (
                            <span className={cn(!byPerson && 'inline-block border-b-[3px] pb-px', !byPerson && loadClass(s))}>
                              {hours(s)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    {multiWeek && (
                      <td className={cn(cellBase, 'sticky bottom-0 z-10 border-t-2 bg-muted text-center tabular-nums')}>{wk > 0 && hours(wk)}</td>
                    )}
                  </Fragment>
                );
              })}
              <td className={cn(cellBase, stickyRight, 'bottom-0 z-20 border-t-2')}>{hours(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
        {byPerson ? 'Each person’s day:' : 'Daily totals:'}
        <span className="border-b-[3px] border-amber-500">under {LOW_H}h</span>
        <span className="border-b-[3px] border-emerald-500">{LOW_H}–{DAY_TARGET_H}h</span>
        <span className="border-b-[3px] border-red-500">over {DAY_TARGET_H}h</span>
        <span>· hover a cell for times and comments</span>
      </div>
    </Card>
  );
}

function EntryTip({ task, day }: { task: TaskRow; day: string }) {
  const list = [...(task.perDay.get(day) ?? [])].sort((a, b) => (a.started < b.started ? -1 : 1));
  const total = list.reduce((s, e) => s + e.timeSpentSeconds, 0);
  return (
    <div className="grid min-w-52 gap-1.5">
      <div className="flex justify-between gap-4">
        <span>
          <b>{task.key}</b> · {formatDay(day)}
        </span>
        <b>{hours(total)}h</b>
      </div>
      {list.map((e) => {
        const r = timeRange(e.started, e.timeSpentSeconds);
        return (
          <div key={e.id} className="border-t border-background/20 pt-1.5">
            <div className="flex justify-between gap-4">
              <span className="font-semibold tabular-nums">
                {r.from} – {r.to}
                {r.nextDay && <sup>+1</sup>}
              </span>
              <span>{hours(e.timeSpentSeconds)}h</span>
            </div>
            {e.comment && <div className="whitespace-pre-line opacity-75">{e.comment}</div>}
          </div>
        );
      })}
    </div>
  );
}
