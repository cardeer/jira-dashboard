import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDay, formatDuration, timeRange } from '@/dates';
import { cn } from '@/lib/utils';
import type { WorklogEntry } from '../../../shared/types';
import { DAY_TARGET } from './aggregate';

export function ByDay({ entries, site }: { entries: WorklogEntry[]; site: string }) {
  const days = useMemo(() => {
    const m = new Map<string, WorklogEntry[]>();
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    // Newest day first; within a day, earliest entry first so the times read in order.
    for (const list of m.values()) list.sort((a, b) => (a.started < b.started ? -1 : 1));
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  if (days.length === 0) return <Card className="p-10 text-center text-sm text-muted-foreground">No work logged in this period.</Card>;

  return (
    <div className="grid gap-3">
      {days.map(([day, list]) => {
        const secs = list.reduce((s, e) => s + e.timeSpentSeconds, 0);
        return (
          <Card key={day} className="gap-0 py-0">
            <CardHeader className="flex items-center justify-between border-b px-4 py-3!">
              <CardTitle className="text-sm">{formatDay(day, { year: 'numeric' })}</CardTitle>
              <span className={cn('text-sm tabular-nums', secs >= DAY_TARGET ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                {formatDuration(secs)}
              </span>
            </CardHeader>
            <CardContent className="divide-y px-0">
              {list.map((e) => {
                const r = timeRange(e.started, e.timeSpentSeconds);
                return (
                  <div key={e.id} className="flex items-start gap-4 px-4 py-3">
                    <div className="w-28 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                      {r.from} – {r.to}
                      {r.nextDay && <sup>+1</sup>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <a href={`${site}/browse/${e.issueKey}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-link hover:underline">
                          {e.issueKey}
                        </a>
                        <span className="text-sm">{e.summary}</span>
                        <span className="text-xs text-muted-foreground">{e.projectName}</span>
                      </div>
                      {e.comment && <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">{e.comment}</p>}
                    </div>
                    <div className="shrink-0 text-sm font-semibold tabular-nums">{formatDuration(e.timeSpentSeconds)}</div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
