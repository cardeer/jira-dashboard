import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { Progress } from '@/components/ui/progress';
import { formatDay, formatDuration, fromISO } from '@/dates';
import type { WorklogEntry } from '../../../shared/types';
import { DAY_TARGET, type Summary } from './aggregate';

const chartConfig = { hours: { label: 'Hours', color: 'var(--primary)' } } satisfies ChartConfig;

export function Visualization({ stats, entries }: { stats: Summary; entries: WorklogEntry[] }) {
  const dense = stats.perDay.length > 14;
  const data = useMemo(
    () =>
      stats.perDay.map(([day, secs]) => ({
        day,
        label: dense ? String(fromISO(day).getDate()) : formatDay(day, { day: undefined, month: undefined }),
        hours: Math.round((secs / 3600) * 100) / 100,
        seconds: secs,
      })),
    [stats.perDay, dense],
  );

  // Per-day task breakdown for the chart tooltip.
  const tasksByDay = useMemo(() => {
    const m = new Map<string, Map<string, { key: string; summary: string; seconds: number }>>();
    for (const e of entries) {
      const day = m.get(e.date) ?? new Map();
      const t = day.get(e.issueKey) ?? { key: e.issueKey, summary: e.summary, seconds: 0 };
      t.seconds += e.timeSpentSeconds;
      day.set(e.issueKey, t);
      m.set(e.date, day);
    }
    return m;
  }, [entries]);

  const max = Math.max(DAY_TARGET / 3600, ...data.map((d) => d.hours));

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total logged" value={formatDuration(stats.total)} />
        <Stat label="Days with logs" value={String(stats.daysLogged)} sub={`of ${stats.days} in range`} />
        <Stat label="Avg per logged day" value={stats.daysLogged ? formatDuration(stats.total / stats.daysLogged) : '—'} />
        <Stat
          label="Tasks worked on"
          value={String(stats.byTask.length)}
          sub={`${stats.byProject.length} project${stats.byProject.length === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Hours per day</CardTitle>
            <CardDescription>Dashed line is the 8h target. Hover a day for its tasks.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
              <BarChart data={data} margin={{ top: 8, right: 8, left: -16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={40} domain={[0, Math.ceil(max)]} allowDecimals={false} />
                <ReferenceLine y={DAY_TARGET / 3600} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <ChartTooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                    if (!active || !p) return null;
                    const tasks = [...(tasksByDay.get(p.day)?.values() ?? [])].sort((a, b) => b.seconds - a.seconds);
                    return (
                      <div className="grid min-w-48 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">{formatDay(p.day, { year: 'numeric' })}</span>
                          <b>{p.seconds ? formatDuration(p.seconds) : 'Nothing logged'}</b>
                        </div>
                        {tasks.slice(0, 5).map((t) => (
                          <div key={t.key} className="flex justify-between gap-4">
                            <span className="max-w-52 truncate">
                              <b>{t.key}</b> <span className="text-muted-foreground">{t.summary}</span>
                            </span>
                            <span className="tabular-nums">{formatDuration(t.seconds)}</span>
                          </div>
                        ))}
                        {tasks.length > 5 && <div className="text-muted-foreground">+{tasks.length - 5} more</div>}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="hours" fill="var(--color-hours)" radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>By project / team</CardTitle>
            <CardDescription>Share of your logged time.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {stats.byProject.length === 0 && <p className="text-sm text-muted-foreground">Nothing logged.</p>}
            {stats.byProject.map((p) => {
              const pct = (p.seconds / stats.total) * 100;
              return (
                <div key={p.key} className="grid gap-1.5">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="truncate">
                      <span className="font-medium">{p.key}</span> <span className="text-muted-foreground">{p.name}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {formatDuration(p.seconds)} · {Math.round(pct)}%
                    </span>
                  </div>
                  <Progress value={pct} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardHeader>
    </Card>
  );
}
