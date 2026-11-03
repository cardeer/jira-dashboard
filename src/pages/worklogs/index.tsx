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
import { BoardPicker } from '@/components/board-picker';
import { UserPicker } from '@/components/user-picker';
import { api, type Board } from '@/api';
import { PRESETS, formatDuration, fromISO, monthGrid, presetRange, toISO, type Preset } from '@/dates';
import { useSession } from '@/lib/session';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useRememberedSearch, useSearchState } from '@/lib/use-search-state';
import { cn } from '@/lib/utils';
import { sheets, sheetsConfigured } from '@/sheets';
import { useAsync } from '@/useAsync';
import type { Person, WorklogEntry } from '../../../shared/types';
import { summarize } from './aggregate';
import { holidayDays, leaveDays } from './leaves';
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

// Filters remembered between visits (the calendar month is not: it opens on this month).
const REMEMBERED = ['view', 'range', 'from', 'to', 'user', 'board'] as const;

export function WorklogsPage() {
  const ready = useRememberedSearch('jira-dashboard:worklogs-filters', REMEMBERED);
  return ready ? <WorklogsPageContent /> : null;
}

function WorklogsPageContent() {
  const { creds, me } = useSession();
  const { get, set } = useSearchState();

  // ?user=<accountId>,<accountId>… views those people's logs, ?user=all everyone's (both read-only);
  // absent (or just you) means you.
  const userParam = get('user');
  const everyone = userParam === 'all';
  const userIds = everyone ? [] : [...new Set(userParam.split(',').filter(Boolean))];
  const viewingKey = userIds.length === 1 && userIds[0] === me.accountId ? '' : userIds.join(',');
  const viewingIds = useMemo(() => (viewingKey ? viewingKey.split(',') : []), [viewingKey]);
  // Several people's logs are broken down per person, like everyone's.
  const perPerson = everyone || viewingIds.length > 1;

  // ?board=<id> limits logs to that Jira board's issues (a team's board).
  const boardId = /^\d+$/.test(get('board')) ? get('board') : null;
  const [pickedBoard, setPickedBoard] = useState<Board | null>(null);
  const boardReq = useAsync((s) => (boardId ? api.board(creds, boardId, s) : Promise.resolve(null)), [creds, boardId]);
  const board = boardId ? (boardReq.data ?? (pickedBoard?.id === boardId ? pickedBoard : null)) : null;
  const [picked, setPicked] = useState<Person[]>([]);
  const peopleReq = useAsync(
    (s) => Promise.all(viewingIds.map((id) => (id === me.accountId ? me : api.user(creds, id, s)))),
    [creds, me, viewingIds],
  );
  // Show the picked people immediately while their profiles load (or when opened from a link).
  const people = viewingIds.map(
    (id): Person =>
      peopleReq.data?.find((p) => p.accountId === id) ??
      picked.find((p) => p.accountId === id) ?? { accountId: id, displayName: '…' },
  );
  const person = viewingIds.length === 1 ? people[0] : null;
  const firstName = person?.displayName.split(/\s+/)[0] ?? 'They';
  const firstNames = people.map((p) => p.displayName.split(/\s+/)[0]);

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
  const [editing, setEditing] = useState<WorklogEntry | null>(null);
  // Work can always be logged, but only as yourself (Jira's rule), so only your own logs are editable.
  const canEdit = (e: WorklogEntry) => e.authorId === me.accountId;

  const scope = everyone ? 'all' : viewingIds;
  const { data: result, loading, error, reload } = useAsync(
    (s) => api.worklogs(creds, range.from, range.to, scope, boardId, s),
    [creds, range.from, range.to, scope, boardId],
  );
  const data = result?.entries ?? null;
  // Holidays, and leaves for the people shown, from the Google Sheet. Optional: without the sheet
  // the page works as before.
  const timeOff = useAsync((s) => (sheetsConfigured ? sheets.list(s) : Promise.resolve(null)), []);
  const holidays = useMemo(() => holidayDays(timeOff.data?.holidays ?? [], range.from, range.to), [timeOff.data, range.from, range.to]);
  const leaves = useMemo(() => {
    const shownIds = viewingIds.length ? viewingIds : [me.accountId];
    const rows = (timeOff.data?.leaves ?? []).filter((l) => everyone || shownIds.includes(l.account_id));
    return leaveDays(rows, range.from, range.to, holidays);
  }, [timeOff.data, everyone, viewingIds, me.accountId, range.from, range.to, holidays]);
  const title = everyone
    ? 'All members’ work logs'
    : viewingIds.length > 3
      ? `${viewingIds.length} people’s work logs`
      : viewingIds.length > 1
        ? `${firstNames.slice(0, -1).join(', ')} & ${firstNames[firstNames.length - 1]}’s work logs`
        : person
          ? `${person.displayName}’s work logs`
          : 'Work logs';
  useDocumentTitle(title);
  const stats = useMemo(() => summarize(data ?? [], range.from, range.to), [data, range.from, range.to]);

  return (
    <>
      <PageHeader
        title={title}
        description={
          everyone
            ? 'Everyone’s logged time on issues you can browse, broken down per person.'
            : viewingIds.length > 1
              ? 'Their logged time on issues you can browse, broken down per person.'
              : person
                ? `Time ${firstName} logged across every project and team. Work you log is always logged as yourself.`
                : 'Time you logged across every project and team.'
        }
        badge={board ? `Board: ${board.name}` : undefined}
        actions={
          <>
            <BoardPicker
              value={board}
              onChange={(b) => {
                setPickedBoard(b);
                set({ board: b?.id ?? null });
              }}
            />
            <UserPicker
              multiple
              value={everyone ? 'all' : people}
              onChange={(v) => {
                if (v !== 'all') setPicked((prev) => [...v, ...prev.filter((p) => !v.some((x) => x.accountId === p.accountId))]);
                set({ user: v === 'all' ? 'all' : v.map((p) => p.accountId).join(',') || null });
              }}
            />
            <Button onClick={() => setLogDate(toISO(new Date()))}>
              <PlusIcon data-icon="inline-start" /> Log work
            </Button>
          </>
        }
      />

      {peopleReq.error && <ErrorAlert error={peopleReq.error} onRetry={peopleReq.reload} />}
      {boardReq.error && <ErrorAlert error={boardReq.error} onRetry={boardReq.reload} />}
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
              <Timesheet
                key={perPerson ? 'person' : 'project'}
                entries={data}
                leaves={leaves}
                holidays={holidays}
                from={range.from}
                to={range.to}
                site={creds.site}
                groupBy={perPerson ? 'person' : 'project'}
                onEdit={setEditing}
                canEdit={canEdit}
              />
            </TabsContent>
            <TabsContent value="calendar">
              <CalendarView entries={data} leaves={leaves} holidays={holidays} month={month} onDayClick={setLogDate} showPeople={perPerson} onEdit={setEditing} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="day">
              <ByDay entries={data} site={creds.site} showPeople={perPerson} onEdit={setEditing} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="task">
              <ByTask groups={stats.byTask} total={stats.total} site={creds.site} showPeople={perPerson} />
            </TabsContent>
            <TabsContent value="charts">
              <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                <Visualization stats={stats} entries={data} showPeople={perPerson} />
              </Suspense>
            </TabsContent>
          </div>
        )}
      </Tabs>

      <LogWorkDialog
        open={logDate !== null || editing !== null}
        onOpenChange={(o) => {
          if (o) return;
          setLogDate(null);
          setEditing(null);
        }}
        date={logDate ?? toISO(new Date())}
        entry={editing}
        onLogged={reload}
      />
    </>
  );
}
