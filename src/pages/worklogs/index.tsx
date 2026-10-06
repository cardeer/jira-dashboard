import { lazy, Suspense, useMemo } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { api } from '@/api';
import { PRESETS, formatDuration, presetRange, type Preset } from '@/dates';
import { useSession } from '@/lib/session';
import { useSearchState } from '@/lib/use-search-state';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import { summarize } from './aggregate';
import { ByDay } from './by-day';
import { ByTask } from './by-task';
import { DateRangePicker } from './date-range-picker';
import { Timesheet } from './timesheet';

// Recharts is the heaviest dependency: only load it when the Visualization tab is opened.
const Visualization = lazy(() => import('./visualization').then((m) => ({ default: m.Visualization })));

type View = 'timesheet' | 'day' | 'task' | 'charts';
const VIEWS: { id: View; label: string }[] = [
  { id: 'timesheet', label: 'Timesheet' },
  { id: 'day', label: 'By day' },
  { id: 'task', label: 'By task' },
  { id: 'charts', label: 'Visualization' },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function WorklogsPage() {
  const { creds } = useSession();
  const { get, set } = useSearchState();

  // URL: ?range=<preset> or ?from=YYYY-MM-DD&to=YYYY-MM-DD, plus ?view=<view>.
  const customFrom = get('from');
  const customTo = get('to');
  const isCustom = DATE_RE.test(customFrom) && DATE_RE.test(customTo) && customFrom <= customTo;
  const preset = (PRESETS.some((p) => p.id === get('range')) ? get('range') : 'this-week') as Preset;
  const range = isCustom ? { from: customFrom, to: customTo } : presetRange(preset);
  const view = (VIEWS.some((v) => v.id === get('view')) ? get('view') : 'timesheet') as View;

  const { data, loading, error, reload } = useAsync(
    (s) => api.worklogs(creds, range.from, range.to, s),
    [creds, range.from, range.to],
  );
  const stats = useMemo(() => summarize(data ?? [], range.from, range.to), [data, range.from, range.to]);

  return (
    <>
      <PageHeader title="Work logs" description="Time you logged across every project and team." />

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
              <Timesheet entries={data} from={range.from} to={range.to} site={creds.site} />
            </TabsContent>
            <TabsContent value="day">
              <ByDay entries={data} site={creds.site} />
            </TabsContent>
            <TabsContent value="task">
              <ByTask groups={stats.byTask} total={stats.total} site={creds.site} />
            </TabsContent>
            <TabsContent value="charts">
              <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                <Visualization stats={stats} entries={data} />
              </Suspense>
            </TabsContent>
          </div>
        )}
      </Tabs>
    </>
  );
}
