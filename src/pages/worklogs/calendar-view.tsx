import { Fragment, useMemo } from 'react';
import { PartyPopperIcon, PencilIcon, PlusIcon, TreePalmIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { formatDay, formatDuration, fromISO, isWeekend, monthGrid, timeRange, toISO } from '@/dates';
import { cn } from '@/lib/utils';
import type { Holiday, WorklogEntry } from '../../../shared/types';
import { PersonAvatar } from '@/components/person-avatar';
import { hours } from './aggregate';
import { leaveLabel, leaveTime, type LeaveDay } from './leaves';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 3;

/** Under / within / over an 8h day, as a coloured dot next to the daily total. */
function loadDot(seconds: number) {
  const h = seconds / 3600;
  if (h > 8) return 'bg-red-500';
  if (h >= 6) return 'bg-emerald-500';
  return 'bg-amber-500';
}

interface Props {
  entries: WorklogEntry[];
  /** Leaves by day, shown as chips above the work logs. */
  leaves?: Map<string, LeaveDay[]>;
  /** Company holidays by day, shown as chips above the leaves. */
  holidays?: Map<string, Holiday[]>;
  /** YYYY-MM */
  month: string;
  /** Omit for read-only calendars (viewing someone else's logs). */
  onDayClick?: (date: string) => void;
  /** All-members mode: chips per person instead of per log. */
  showPeople?: boolean;
  /** Makes logs in the day's hover card clickable to edit them. */
  onEdit?: (entry: WorklogEntry) => void;
}

interface Chip {
  key: string;
  label: string;
  seconds: number;
}

export function CalendarView({ entries, leaves, holidays, month, onDayClick, showPeople = false, onEdit }: Props) {
  const { days } = useMemo(() => monthGrid(month), [month]);
  const today = toISO(new Date());

  const byDay = useMemo(() => {
    const m = new Map<string, WorklogEntry[]>();
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    for (const list of m.values()) list.sort((a, b) => (a.started < b.started ? -1 : 1));
    return m;
  }, [entries]);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid grid-cols-7 border-b bg-muted/60">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={cn('px-2 py-2 text-center text-xs font-medium text-muted-foreground', i >= 5 && 'text-red-500')}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const list = byDay.get(day) ?? [];
          const dayLeaves = leaves?.get(day) ?? [];
          const dayHolidays = holidays?.get(day) ?? [];
          const total = list.reduce((s, e) => s + e.timeSpentSeconds, 0);
          const chips: Chip[] = showPeople
            ? [
                ...list
                  .reduce((m, e) => {
                    const c = m.get(e.authorId) ?? { key: e.authorId, label: e.authorName.split(/\s+/)[0], seconds: 0 };
                    c.seconds += e.timeSpentSeconds;
                    return m.set(e.authorId, c);
                  }, new Map<string, Chip>())
                  .values(),
              ].sort((a, b) => b.seconds - a.seconds)
            : list.map((e) => ({ key: e.id, label: e.issueKey, seconds: e.timeSpentSeconds }));
          const inMonth = day.startsWith(month);
          const isToday = day === today;

          const cell = (
            <button
              type="button"
              onClick={onDayClick ? () => onDayClick(day) : undefined}
              aria-label={`${formatDay(day, { year: 'numeric' })}: ${total ? formatDuration(total) : 'nothing'} logged${onDayClick ? '. Log work' : ''}`}
              className={cn(
                'group relative flex min-h-28 flex-col gap-1 border-r border-b p-1.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                onDayClick ? 'hover:bg-accent/60' : 'cursor-default',
                (i + 1) % 7 === 0 && 'border-r-0',
                isWeekend(day) && 'bg-muted/40',
                dayHolidays.length > 0 && 'bg-rose-500/5',
                !inMonth && 'bg-muted/60 text-muted-foreground',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                    isToday && 'bg-primary text-primary-foreground',
                    !inMonth && 'font-normal opacity-60',
                  )}
                >
                  {fromISO(day).getDate()}
                </span>
                {total > 0 ? (
                  <span className="flex items-center gap-1 text-xs font-semibold tabular-nums">
                    {!showPeople && <span className={cn('size-1.5 rounded-full', loadDot(total))} />}
                    {hours(total)}h
                  </span>
                ) : (
                  onDayClick && (
                    <PlusIcon className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )
                )}
              </div>
              <div className="grid gap-0.5">
                {dayHolidays.map((h) => (
                  <span
                    key={h.id}
                    className={cn(
                      'flex items-center gap-1 truncate rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] leading-tight font-medium text-rose-700 dark:text-rose-300',
                      !inMonth && 'opacity-60',
                    )}
                  >
                    <PartyPopperIcon className="size-3 shrink-0" />
                    <span className="truncate">{h.name}</span>
                  </span>
                ))}
                {dayLeaves.map(({ leave }) => (
                  <span
                    key={leave.id}
                    className={cn(
                      'flex items-center gap-1 truncate rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] leading-tight font-medium text-violet-700 dark:text-violet-300',
                      !inMonth && 'opacity-60',
                    )}
                  >
                    <TreePalmIcon className="size-3 shrink-0" />
                    <span className="truncate">
                      {showPeople ? leave.name.split(/\s+/)[0] : leaveLabel(leave)}
                      {leave.start_time && ` · ${leave.start_time}`}
                    </span>
                  </span>
                ))}
                {chips.slice(0, MAX_CHIPS).map((c) => (
                  <span
                    key={c.key}
                    className={cn(
                      'truncate rounded bg-primary/10 px-1.5 py-0.5 text-[11px] leading-tight',
                      !inMonth && 'opacity-60',
                    )}
                  >
                    <span className="font-semibold text-link">{c.label}</span>{' '}
                    <span className="tabular-nums">{hours(c.seconds)}h</span>
                  </span>
                ))}
                {chips.length > MAX_CHIPS && (
                  <span className="px-1.5 text-[11px] text-muted-foreground">+{chips.length - MAX_CHIPS} more</span>
                )}
              </div>
            </button>
          );

          if (list.length === 0 && dayLeaves.length === 0 && dayHolidays.length === 0) return <Fragment key={day}>{cell}</Fragment>;
          return (
            <HoverCard key={day} openDelay={120} closeDelay={60}>
              <HoverCardTrigger asChild>{cell}</HoverCardTrigger>
              <HoverCardContent side="right" align="start" className="w-80 p-0">
                <DayDetails day={day} list={list} leaves={dayLeaves} holidays={dayHolidays} total={total} canLog={Boolean(onDayClick)} showPeople={showPeople} onEdit={onEdit} />
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </div>
    </Card>
  );
}

function DayDetails({
  day,
  list,
  leaves,
  holidays,
  total,
  canLog,
  showPeople,
  onEdit,
}: {
  day: string;
  list: WorklogEntry[];
  leaves: LeaveDay[];
  holidays: Holiday[];
  total: number;
  canLog: boolean;
  showPeople: boolean;
  onEdit?: (entry: WorklogEntry) => void;
}) {
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium">{formatDay(day, { year: 'numeric' })}</span>
        <span className="font-semibold tabular-nums">{formatDuration(total)}</span>
      </div>
      <div className="max-h-80 divide-y overflow-auto">
        {holidays.map((h) => (
          <div key={h.id} className="grid gap-0.5 bg-rose-500/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
              <PartyPopperIcon className="size-3.5" />
              {h.name}
            </span>
            {h.note && <p className="text-xs whitespace-pre-line text-muted-foreground">{h.note}</p>}
          </div>
        ))}
        {leaves.map(({ leave, seconds }) => (
          <div key={leave.id} className="grid gap-0.5 bg-violet-500/10 px-3 py-2">
            <div className="flex justify-between gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-violet-700 dark:text-violet-300">
                <TreePalmIcon className="size-3.5" />
                {leaveLabel(leave)}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {leaveTime(leave)} · {formatDuration(seconds)}
              </span>
            </div>
            {showPeople && <div className="text-xs font-medium">{leave.name}</div>}
            {leave.note && <p className="text-xs whitespace-pre-line text-muted-foreground">{leave.note}</p>}
          </div>
        ))}
        {list.map((e) => {
          const r = timeRange(e.started, e.timeSpentSeconds);
          const Row = onEdit ? 'button' : 'div';
          return (
            <Row
              key={e.id}
              {...(onEdit && { type: 'button' as const, title: 'Edit work log', onClick: () => onEdit(e) })}
              className={cn(
                'group grid w-full gap-0.5 px-3 py-2 text-left',
                onEdit && 'cursor-pointer outline-none hover:bg-accent/60 focus-visible:bg-accent/60',
              )}
            >
              <div className="flex justify-between gap-3">
                <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                  {r.from} – {r.to}
                  {r.nextDay && <sup>+1</sup>}
                </span>
                <span className="flex items-center gap-1.5 text-xs font-semibold tabular-nums">
                  {onEdit && <PencilIcon className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                  {formatDuration(e.timeSpentSeconds)}
                </span>
              </div>
              {showPeople && (
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <PersonAvatar person={{ displayName: e.authorName, avatarUrl: e.authorAvatar }} className="size-4" />
                  {e.authorName}
                </div>
              )}
              <div className="truncate">
                <span className="font-medium text-link">{e.issueKey}</span> {e.summary}
              </div>
              {e.comment && <p className="text-xs whitespace-pre-line text-muted-foreground">{e.comment}</p>}
            </Row>
          );
        })}
      </div>
      {canLog && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          Click the day to log more work{onEdit && ', or a log above to edit it'}.
        </div>
      )}
    </div>
  );
}
