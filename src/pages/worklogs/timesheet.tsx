import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronDownIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, PencilIcon, TreePalmIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { eachDay, formatDay, formatDuration, fromISO, isWeekend, timeRange, toISO } from '@/dates';
import { cn } from '@/lib/utils';
import type { Holiday, WorklogEntry } from '../../../shared/types';
import { PersonAvatar } from '@/components/person-avatar';
import { hours } from './aggregate';
import { leaveLabel, leaveTime, type LeaveDay } from './leaves';

/** Space kept below the card: the page's bottom padding plus the card border. */
const PAGE_BOTTOM_PX = 26;
const MIN_SCROLL_PX = 240;

/**
 * Height for the table's scroll area so the card ends at the bottom of the window: the page never
 * scrolls, the table does (header row, task column and totals stay pinned). Recomputed when the
 * window or anything above it (filters, alerts) changes size.
 */
function useFitToViewport(scroll: RefObject<HTMLElement | null>, footer: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const update = () => {
      const el = scroll.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const below = (footer.current?.offsetHeight ?? 0) + PAGE_BOTTOM_PX;
      setHeight(Math.max(MIN_SCROLL_PX, Math.floor(window.innerHeight - top - below)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    if (footer.current) ro.observe(footer.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [scroll, footer]);
  return height;
}

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
  /** Leaves by day, shown as their own rows; not counted in the work totals. */
  leaves?: Map<string, LeaveDay[]>;
  /** Company holidays by day: their columns are tinted and named in the day header. */
  holidays?: Map<string, Holiday[]>;
  from: string;
  to: string;
  site: string;
  /** 'project' for one person's logs; 'person' (person → tasks) when viewing all members. */
  groupBy?: 'project' | 'person';
  /** Makes task cells clickable to edit their logs (omitted when viewing others' logs). */
  onEdit?: (entry: WorklogEntry) => void;
}

const logsOn = (task: TaskRow, day: string) =>
  [...(task.perDay.get(day) ?? [])].sort((a, b) => (a.started < b.started ? -1 : 1));

export function Timesheet({ entries, leaves, holidays, from, to, site, groupBy = 'project', onEdit }: Props) {
  // A cell with several logs asks which one to edit, in a popover anchored to that cell.
  const [chooser, setChooser] = useState<{ task: TaskRow; day: string } | null>(null);
  const chooserAnchor = useRef<HTMLElement | null>(null);
  const editCell = (task: TaskRow, day: string, el: HTMLElement) => {
    const list = logsOn(task, day);
    if (list.length === 1) return onEdit?.(list[0]);
    chooserAnchor.current = el;
    setChooser({ task, day });
  };

  const byPerson = groupBy === 'person';
  // Groups whose state differs from the default: people start collapsed (one total row each),
  // projects start expanded.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (key: string) => (byPerson ? toggled.has(key) : !toggled.has(key));
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

  // Leaves per person. All members: shown in each person's row; one person: a "Leave" row.
  const leaveRows = useMemo(() => {
    const rows = new Map<string, { key: string; name: string; perDay: Map<string, LeaveDay[]>; total: number }>();
    for (const [day, list] of leaves ?? []) {
      for (const ld of list) {
        const r = rows.get(ld.leave.account_id) ?? { key: ld.leave.account_id, name: ld.leave.name, perDay: new Map(), total: 0 };
        rows.set(r.key, r);
        r.perDay.set(day, [...(r.perDay.get(day) ?? []), ld]);
        r.total += ld.seconds;
      }
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [leaves]);
  const leaveOf = (personId: string, day: string) => leaveRows.find((r) => r.key === personId)?.perDay.get(day) ?? [];

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
    // People on leave with nothing logged still get a row to show it.
    if (byPerson) {
      for (const r of leaveRows) {
        if (!projects.has(r.key)) projects.set(r.key, { key: r.key, name: r.name, tasks: [], perDay: new Map(), total: 0 });
      }
    }
    const groups = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const g of groups) g.tasks.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
    return { groups, dayTotals, grandTotal };
  }, [entries, byPerson, leaveRows]);

  const toggle = (key: string) =>
    setToggled((s) => {
      const n = new Set(s);
      if (!n.delete(key)) n.add(key);
      return n;
    });

  const isHoliday = (d: string) => Boolean(holidays?.has(d));
  const dayBg = (d: string) => cn(isWeekend(d) && weekendBg, isHoliday(d) && !isWeekend(d) && 'bg-rose-500/10', d === today && 'bg-primary/5');

  /** One row's day cells plus week subtotals. */
  const cells = (
    perDay: (d: string) => number,
    opts: {
      underline?: boolean;
      tip?: (d: string) => ReactNode;
      rowBg?: string;
      onClick?: (d: string, el: HTMLElement) => void;
      /** The row's leaves on a day: tints the cell and adds them to its tooltip. */
      leave?: (d: string) => LeaveDay[];
    } = {},
  ) =>
    weeks.map((w) => {
      const wk = w.days.reduce((s, d) => s + perDay(d), 0);
      return (
        <Fragment key={w.days[0]}>
          {w.days.map((d) => {
            const s = perDay(d);
            const onLeave = opts.leave?.(d) ?? [];
            const content = (
              <>
                {s > 0 && (
                  <span className={cn(opts.underline && 'inline-block border-b-[3px] pb-px', opts.underline && loadClass(s))}>
                    {hours(s)}
                  </span>
                )}
                {onLeave.length > 0 && (
                  <TreePalmIcon className={cn('inline size-3.5 text-violet-600 dark:text-violet-300', s > 0 && 'ml-0.5 size-3 align-super')} />
                )}
              </>
            );
            const className = cn(cellBase, dayCell, onLeave.length > 0 ? 'bg-violet-500/15' : [opts.rowBg, dayBg(d)]);
            const tip = (s > 0 && opts.tip) || onLeave.length > 0;
            if (tip) {
              return (
                // Not hoverable: the tooltip covers the cell above, which must stay reachable.
                <Tooltip key={d} disableHoverableContent>
                  <TooltipTrigger asChild>
                    <td
                      tabIndex={0}
                      className={cn(
                        className,
                        opts.onClick ? 'cursor-pointer' : 'cursor-default',
                        'outline-none hover:ring-2 hover:ring-primary hover:ring-inset focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                      )}
                      {...(opts.onClick && {
                        role: 'button',
                        onClick: (ev: React.MouseEvent<HTMLElement>) => opts.onClick!(d, ev.currentTarget),
                        onKeyDown: (ev: React.KeyboardEvent<HTMLElement>) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            opts.onClick!(d, ev.currentTarget);
                          }
                        },
                      })}
                    >
                      {content}
                    </td>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="pointer-events-none grid max-w-xs gap-2">
                    {onLeave.length > 0 && <LeaveTip day={d} list={onLeave} />}
                    {s > 0 && opts.tip?.(d)}
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const maxHeight = useFitToViewport(scrollRef, footerRef);

  if (entries.length === 0 && leaveRows.length === 0) {
    return <Card className="p-10 text-center text-sm text-muted-foreground">No work logged in this period.</Card>;
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
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
                  {w.days.map((d) => {
                    const off = isWeekend(d) || isHoliday(d);
                    const th = (
                      <th
                        key={d}
                        className={cn(
                          cellBase,
                          dayCell,
                          'sticky top-9 z-20 bg-card leading-tight',
                          isHoliday(d) && 'cursor-default bg-rose-50 dark:bg-rose-950',
                          d === today && 'bg-accent',
                          off && 'text-red-500',
                        )}
                      >
                        <span className={cn('block text-sm font-semibold', d === today && 'text-primary')}>{fromISO(d).getDate()}</span>
                        <span className={cn('block text-[10px] font-medium tracking-wide', !off && 'text-muted-foreground')}>
                          {formatDay(d, { day: undefined, month: undefined }).slice(0, 2).toUpperCase()}
                        </span>
                      </th>
                    );
                    if (!isHoliday(d)) return th;
                    return (
                      <Tooltip key={d} disableHoverableContent>
                        <TooltipTrigger asChild>{th}</TooltipTrigger>
                        <TooltipContent side="bottom" className="pointer-events-none max-w-xs">
                          <b>{holidays!.get(d)!.map((h) => h.name).join(', ')}</b> · {formatDay(d)}
                          {holidays!.get(d)!.map((h) => h.note && <div key={h.id} className="opacity-75">{h.note}</div>)}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                  {multiWeek && (
                    <th className={cn(cellBase, 'sticky top-9 z-20 bg-muted text-xs font-medium text-muted-foreground')}>Week</th>
                  )}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {!byPerson && leaveRows.map((r) => (
              <tr key={`leave-${r.key}`} className="text-violet-700 dark:text-violet-300">
                <td className={cn(cellBase, stickyLeft, 'bg-violet-50 font-semibold dark:bg-violet-950')}>
                  <span className="inline-flex items-center gap-1.5">
                    <TreePalmIcon className="size-4" />
                    Leave
                  </span>
                </td>
                {cells((d) => (r.perDay.get(d) ?? []).reduce((s, ld) => s + ld.seconds, 0), {
                  rowBg: 'bg-violet-500/10',
                  tip: (d) => <LeaveTip day={d} list={r.perDay.get(d) ?? []} />,
                })}
                <td className={cn(cellBase, stickyRight)}>{hours(r.total)}</td>
              </tr>
            ))}
            {groups.map((g) => {
              const open = isOpen(g.key);
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
                    {cells((d) => g.perDay.get(d) ?? 0, {
                      rowBg: 'bg-muted',
                      underline: byPerson,
                      leave: byPerson ? (d) => leaveOf(g.key, d) : undefined,
                    })}
                    <td className={cn(cellBase, stickyRight)}>{hours(g.total)}</td>
                  </tr>
                  {open &&
                    g.tasks.map((t) => (
                      <tr key={t.key} className="group">
                        <Tooltip disableHoverableContent>
                          <TooltipTrigger asChild>
                            <td className={cn(cellBase, stickyLeft, 'group-hover:bg-accent')}>
                              <a href={`${site}/browse/${t.key}`} target="_blank" rel="noreferrer" className="font-medium text-link hover:underline">
                                {t.key}
                              </a>
                              <span className="ml-1.5">{t.summary}</span>
                            </td>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="pointer-events-none max-w-sm">
                            <b>{t.key}</b> {t.summary}
                          </TooltipContent>
                        </Tooltip>
                        {cells((d) => (t.perDay.get(d) ?? []).reduce((s, e) => s + e.timeSpentSeconds, 0), {
                          tip: (d) => <EntryTip task={t} day={d} editable={Boolean(onEdit)} />,
                          onClick: onEdit && ((d, el) => editCell(t, d, el)),
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
      <div ref={footerRef} className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
        {groups.length > 1 && (
          <Button
            variant="ghost"
            size="xs"
            className="-ml-2"
            onClick={() => {
              const allOpen = groups.every((g) => isOpen(g.key));
              // Store the keys that should differ from each group's default.
              setToggled(new Set(allOpen === byPerson ? [] : groups.map((g) => g.key)));
            }}
          >
            {groups.every((g) => isOpen(g.key)) ? (
              <>
                <ChevronsDownUpIcon data-icon="inline-start" /> Collapse all
              </>
            ) : (
              <>
                <ChevronsUpDownIcon data-icon="inline-start" /> Expand all
              </>
            )}
          </Button>
        )}
        {byPerson ? 'Each person’s day:' : 'Daily totals:'}
        <span className="border-b-[3px] border-amber-500">under {LOW_H}h</span>
        <span className="border-b-[3px] border-emerald-500">{LOW_H}–{DAY_TARGET_H}h</span>
        <span className="border-b-[3px] border-red-500">over {DAY_TARGET_H}h</span>
        {holidays && holidays.size > 0 && (
          <span className="inline-flex items-center gap-1">
            · <span className="inline-block size-3 rounded-sm bg-rose-500/25" /> holiday (hover the date)
          </span>
        )}
        {leaveRows.length > 0 && (
          <span className="inline-flex items-center gap-1">
            · <TreePalmIcon className="size-3.5 text-violet-600 dark:text-violet-300" /> on leave
          </span>
        )}
        <span>· hover a cell for times and comments</span>
      </div>
      <Popover open={chooser !== null} onOpenChange={(o) => !o && setChooser(null)}>
        <PopoverAnchor virtualRef={chooserAnchor} />
        <PopoverContent side="bottom" align="center" className="w-72 p-0">
          {chooser && (
            <LogChooser
              task={chooser.task}
              day={chooser.day}
              onPick={(e) => {
                setChooser(null);
                onEdit?.(e);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </Card>
  );
}

function EntryTip({ task, day, editable }: { task: TaskRow; day: string; editable: boolean }) {
  const list = logsOn(task, day);
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
      {editable && <div className="border-t border-background/20 pt-1.5 opacity-75">Click to edit</div>}
    </div>
  );
}

function LeaveTip({ day, list }: { day: string; list: LeaveDay[] }) {
  return (
    <div className="grid min-w-52 gap-1.5">
      <div>
        <b>{list[0]?.leave.name}</b> · {formatDay(day)}
      </div>
      {list.map(({ leave, seconds }) => (
        <div key={leave.id} className="border-t border-background/20 pt-1.5">
          <div className="flex justify-between gap-4">
            <span className="font-semibold">{leaveLabel(leave)}</span>
            <span className="tabular-nums">
              {leaveTime(leave)} · {hours(seconds)}h
            </span>
          </div>
          {leave.note && <div className="whitespace-pre-line opacity-75">{leave.note}</div>}
        </div>
      ))}
    </div>
  );
}

/** Lists a cell's logs so one can be picked for editing. */
function LogChooser({ task, day, onPick }: { task: TaskRow; day: string; onPick: (e: WorklogEntry) => void }) {
  return (
    <div className="text-sm">
      <div className="border-b px-3 py-2 font-medium">
        <span className="text-link">{task.key}</span> · {formatDay(day)}
        <div className="text-xs font-normal text-muted-foreground">Which log do you want to edit?</div>
      </div>
      <div className="max-h-72 divide-y overflow-auto">
        {logsOn(task, day).map((e) => {
          const r = timeRange(e.started, e.timeSpentSeconds);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onPick(e)}
              className="group grid w-full gap-0.5 px-3 py-2 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent/60"
            >
              <span className="flex justify-between gap-3 text-xs font-semibold tabular-nums">
                <span className="text-muted-foreground">
                  {r.from} – {r.to}
                  {r.nextDay && <sup>+1</sup>}
                </span>
                <span className="flex items-center gap-1.5">
                  <PencilIcon className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  {formatDuration(e.timeSpentSeconds)}
                </span>
              </span>
              {e.comment && <span className="line-clamp-2 text-xs text-muted-foreground">{e.comment}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
