import { lazy, Suspense, useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { UserPicker } from '@/components/user-picker';
import { api } from '@/api';
import { PRESETS, formatDuration, fromISO, monthGrid, presetRange, toISO, type Preset } from '@/dates';
import { useSession } from '@/lib/session';
import { useSearchState } from '@/lib/use-search-state';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import type { Person } from '../../../shared/types';
import { summarize } from './aggregate';
import { ByDay } from './by-day';
import { ByTask } from './by-task';
import { CalendarView } from './calendar-view';
import { DateRangePicker } from './date-range-picker';
import { LogWorkDialog } from './log-work-dialog';
import { Timesheet } from './timesheet';

// Recharts is the heaviest dependency: only load it when the Visualization tab is opened.
const Visualization = lazy(() => import('./visualization').then((m) => ({ default: m.Visualization })));

type View = 'timesheet' | 'calendar' | 'day' | 'task' | 'charts';
const VIEWS: { id: View; label: string }[] = [
  { id: 'timesheet', label: 'Timesheet' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'day', label: 'By day' },
  { id: 'task', label: 'By task' },
  { id: 'charts', label: 'Visualization' },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  return toISO(new Date(y, m - 1 + by, 1)).slice(0, 7);
};

export function WorklogsPage() {
  const { creds, me } = useSession();
  const { get, set } = useSearchState();

  // ?user=<accountId> views someone else's logs, ?user=all everyone's (both read-only); absent means you.
  const userParam = get('user');
  const everyone = userParam === 'all';
  const viewingId = !everyone && userParam && userParam !== me.accountId ? userParam : null;
  const readOnly = everyone || viewingId !== null;
  const [picked, setPicked] = useState<Person | null>(null);
  const personReq = useAsync((s) => (viewingId ? api.user(creds, viewingId, s) : Promise.resolve(null)), [creds, viewingId]);
  // Show the picked person immediately while their profile loads (or when opened from a link).
  const person = viewingId ? (personReq.data ?? (picked?.accountId === viewingId ? picked : null)) : null;
  const firstName = person?.displayName.split(/\s+/)[0] ?? 'They';

  // URL: ?range=<preset> or ?from=YYYY-MM-DD&to=YYYY-MM-DD, plus ?view=<view>.
  const customFrom = get('from');
  const customTo = get('to');
  const isCustom = DATE_RE.test(customFrom) && DATE_RE.test(customTo) && customFrom <= customTo;
  const preset = (PRESETS.some((p) => p.id === get('range')) ? get('range') : 'this-week') as Preset;
  const view = (VIEWS.some((v) => v.id === get('view')) ? get('view') : 'timesheet') as View;
  // The calendar has its own month (?month=YYYY-MM) and loads the full weeks around it.
  const thisMonth = toISO(new Date()).slice(0, 7);
  const month = MONTH_RE.test(get('month')) ? get('month') : thisMonth;
  const range =
    view === 'calendar'
      ? monthGrid(month)
      : isCustom
        ? { from: customFrom, to: customTo }
        : presetRange(preset);
  const [logDate, setLogDate] = useState<string | null>(null);

  const scope = everyone ? 'all' : viewingId;
  const { data: result, loading, error, reload } = useAsync(
    (s) => api.worklogs(creds, range.from, range.to, scope, s),
    [creds, range.from, range.to, scope],
  );
  const data = result?.entries ?? null;
  const stats = useMemo(() => summarize(data ?? [], range.from, range.to), [data, range.from, range.to]);

  return (
    <>
      <PageHeader
        title={everyone ? 'All members’ work logs' : viewingId ? `${person?.displayName ?? 'Someone'}’s work logs` : 'Work logs'}
        description={
          everyone
            ? 'Everyone’s logged time on issues you can browse, broken down per person. View only.'
            : viewingId
              ? `Time ${firstName} logged across every project and team. View only: work is always logged as yourself.`
              : 'Time you logged across every project and team.'
        }
        actions={
          <>
            <UserPicker
              value={everyone ? 'all' : person}
              onChange={(v) => {
                if (v && v !== 'all') setPicked(v);
                set({ user: v === 'all' ? 'all' : v ? v.accountId : null });
              }}
            />
            {!readOnly && (
              <Button onClick={() => setLogDate(toISO(new Date()))}>
                <PlusIcon data-icon="inline-start" /> Log work
              </Button>
            )}
          </>
        }
      />

      {personReq.error && <ErrorAlert error={personReq.error} onRetry={personReq.reload} />}
      {result?.truncated && (
        <Alert className="mb-4">
          <TriangleAlertIcon />
          <AlertTitle>Showing a partial result</AlertTitle>
          <AlertDescription>
            Too many issues have work logged in this range, so only the most recent ones were scanned. Pick a shorter
            range for complete totals.
          </AlertDescription>
        </Alert>
      )}

      {view === 'calendar' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => set({ month: shiftMonth(month, -1) })}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => set({ month: shiftMonth(month, 1) })}>
            <ChevronRightIcon />
          </Button>
          <h2 className="min-w-36 text-base font-semibold">
            {fromISO(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <Button variant="outline" size="sm" disabled={month === thisMonth} onClick={() => set({ month: null })}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCwIcon className={cn(loading && 'animate-spin')} data-icon="inline-start" /> Refresh
          </Button>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={isCustom ? '' : preset}
            onValueChange={(v) => v && set({ range: v === 'this-week' ? null : v, from: null, to: null })}
          >
            {PRESETS.map((p) => (
              <ToggleGroupItem key={p.id} value={p.id}>{p.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <DateRangePicker from={range.from} to={range.to} onChange={(from, to) => set({ from, to, range: null })} />
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCwIcon className={cn(loading && 'animate-spin')} data-icon="inline-start" /> Refresh
          </Button>
        </div>
      )}

      {error && <ErrorAlert error={error} onRetry={reload} />}

      <Tabs value={view} onValueChange={(v) => set({ view: v === 'timesheet' ? null : v })}>
        <div className="mb-3 flex items-center justify-between gap-3 border-b">
          <TabsList variant="line" className="h-10">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.id} value={v.id}>{v.label}</TabsTrigger>
            ))}
          </TabsList>
          {data && (
            <Badge variant="secondary" className="tabular-nums">
              Total {formatDuration(stats.total)}
            </Badge>
          )}
        </div>

        {!data && loading && (
          <Card className="gap-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </Card>
        )}

        {data && (
          <div className={cn(loading && 'opacity-60 transition-opacity')}>
            <TabsContent value="timesheet">
              <Timesheet entries={data} from={range.from} to={range.to} site={creds.site} groupBy={everyone ? 'person' : 'project'} />
            </TabsContent>
            <TabsContent value="calendar">
              <CalendarView entries={data} month={month} onDayClick={readOnly ? undefined : setLogDate} showPeople={everyone} />
            </TabsContent>
            <TabsContent value="day">
              <ByDay entries={data} site={creds.site} showPeople={everyone} />
            </TabsContent>
            <TabsContent value="task">
              <ByTask groups={stats.byTask} total={stats.total} site={creds.site} showPeople={everyone} />
            </TabsContent>
            <TabsContent value="charts">
              <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                <Visualization stats={stats} entries={data} showPeople={everyone} />
              </Suspense>
            </TabsContent>
          </div>
        )}
      </Tabs>

      <LogWorkDialog
        open={logDate !== null}
        onOpenChange={(o) => !o && setLogDate(null)}
        date={logDate ?? toISO(new Date())}
        onLogged={reload}
      />
    </>
  );
}
