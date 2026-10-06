import { Fragment, useMemo } from 'react';
import { PlusIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { formatDay, formatDuration, fromISO, isWeekend, monthGrid, timeRange, toISO } from '@/dates';
import { cn } from '@/lib/utils';
import type { WorklogEntry } from '../../../shared/types';
import { hours } from './aggregate';

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
  /** YYYY-MM */
  month: string;
  onDayClick: (date: string) => void;
}

export function CalendarView({ entries, month, onDayClick }: Props) {
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
          const total = list.reduce((s, e) => s + e.timeSpentSeconds, 0);
          const inMonth = day.startsWith(month);
          const isToday = day === today;

          const cell = (
            <button
              type="button"
              onClick={() => onDayClick(day)}
              aria-label={`${formatDay(day, { year: 'numeric' })}: ${total ? formatDuration(total) : 'nothing'} logged. Log work`}
              className={cn(
                'group relative flex min-h-28 flex-col gap-1 border-r border-b p-1.5 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                (i + 1) % 7 === 0 && 'border-r-0',
                isWeekend(day) && 'bg-muted/40',
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
                    <span className={cn('size-1.5 rounded-full', loadDot(total))} />
                    {hours(total)}h
                  </span>
                ) : (
                  <PlusIcon className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </div>
              <div className="grid gap-0.5">
                {list.slice(0, MAX_CHIPS).map((e) => (
                  <span
                    key={e.id}
                    className={cn(
                      'truncate rounded bg-primary/10 px-1.5 py-0.5 text-[11px] leading-tight',
                      !inMonth && 'opacity-60',
                    )}
                  >
                    <span className="font-semibold text-link">{e.issueKey}</span>{' '}
                    <span className="tabular-nums">{hours(e.timeSpentSeconds)}h</span>
                  </span>
                ))}
                {list.length > MAX_CHIPS && (
                  <span className="px-1.5 text-[11px] text-muted-foreground">+{list.length - MAX_CHIPS} more</span>
                )}
              </div>
            </button>
          );

          if (list.length === 0) return <Fragment key={day}>{cell}</Fragment>;
          return (
            <HoverCard key={day} openDelay={120} closeDelay={60}>
              <HoverCardTrigger asChild>{cell}</HoverCardTrigger>
              <HoverCardContent side="right" align="start" className="w-80 p-0">
                <DayDetails day={day} list={list} total={total} />
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </div>
    </Card>
  );
}

function DayDetails({ day, list, total }: { day: string; list: WorklogEntry[]; total: number }) {
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium">{formatDay(day, { year: 'numeric' })}</span>
        <span className="font-semibold tabular-nums">{formatDuration(total)}</span>
      </div>
      <div className="max-h-80 divide-y overflow-auto">
        {list.map((e) => {
          const r = timeRange(e.started, e.timeSpentSeconds);
          return (
            <div key={e.id} className="grid gap-0.5 px-3 py-2">
              <div className="flex justify-between gap-3">
                <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                  {r.from} – {r.to}
                  {r.nextDay && <sup>+1</sup>}
                </span>
                <span className="text-xs font-semibold tabular-nums">{formatDuration(e.timeSpentSeconds)}</span>
              </div>
              <div className="truncate">
                <span className="font-medium text-link">{e.issueKey}</span> {e.summary}
              </div>
              {e.comment && <p className="text-xs whitespace-pre-line text-muted-foreground">{e.comment}</p>}
            </div>
          );
        })}
      </div>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">Click the day to log more work.</div>
    </div>
  );
}
