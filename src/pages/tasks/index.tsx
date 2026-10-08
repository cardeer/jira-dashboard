import { useState } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
  ListTreeIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SquareKanbanIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BoardPicker } from '@/components/board-picker';
import { PAGE_SIZES } from '@/components/data-pagination';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { PersonAvatar } from '@/components/person-avatar';
import { StatusMenu } from '@/components/status-menu';
import { TaskDetailsSheet } from '@/components/task-details-sheet';
import { api, SHOW_ALL_CAP, type Board, type TaskQuery } from '@/api';
import { formatDay, formatDuration, relativeTime } from '@/dates';
import { formatPoints } from '@/lib/points';
import { useSession } from '@/lib/session';
import { useRememberedSearch, useSearchState, useUrlSearchInput } from '@/lib/use-search-state';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import type { StatusCategory, Task, TaskFilter, TaskScope } from '../../../shared/types';
import { CreateTaskDialog } from './create-task-dialog';
import { SprintView } from './sprint-view';

const SCOPES: { id: TaskScope; label: string }[] = [
  { id: 'mine', label: 'Assigned to me' },
  { id: 'all', label: 'All tasks' },
];
const STATUSES: { id: TaskFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done (30 days)' },
  { id: 'all', label: 'All' },
];

// Filters remembered between visits (search text, page and the open issue are not).
const REMEMBERED = ['view', 'scope', 'status', 'board', 'display', 'size'] as const;

export function TasksPage() {
  const ready = useRememberedSearch('jira-dashboard:tasks-filters', REMEMBERED);
  return ready ? <TasksPageContent /> : null;
}

function TasksPageContent() {
  const { creds } = useSession();
  const { get, set } = useSearchState();

  // URL: ?scope=all&status=done&board=<id>&q=<text>
  const scope = (get('scope') === 'all' ? 'all' : 'mine') as TaskScope;
  const status = (['open', 'done', 'all'].includes(get('status')) ? get('status') : 'open') as TaskFilter;
  const boardId = /^\d+$/.test(get('board')) ? get('board') : null;
  const size = PAGE_SIZES.includes(Number(get('size'))) ? Number(get('size')) : 25;
  // ?display=all shows every matching task on one page; default is paged.
  const showAll = get('display') === 'all';
  // ?view=sprints shows the board's sprints and backlog; ?issue=KEY opens the details panel.
  const view = get('view') === 'sprints' ? 'sprints' : 'list';
  const openIssue = get('issue') || null;
  const [sprintReload, setSprintReload] = useState(0);
  const [query, setQuery] = useUrlSearchInput('q');

  // Show a Tester column only on sites that have a Tester field.
  const fieldIds = useAsync((s) => api.customFieldIds(creds).then((ids) => (s.aborted ? null : ids)), [creds]);
  const hasTester = Boolean(fieldIds.data?.tester);
  // The site's story-point style estimate (e.g. "Estimate Working Hour"); falls back to time estimates.
  const pointsName = fieldIds.data?.storyPoints ? (fieldIds.data.storyPointsName ?? 'Story points') : null;
  const columns = hasTester ? 9 : 8;

  const [pickedBoard, setPickedBoard] = useState<Board | null>(null);
  const boardReq = useAsync((s) => (boardId ? api.board(creds, boardId, s) : Promise.resolve(null)), [creds, boardId]);
  const board = boardId ? (boardReq.data ?? (pickedBoard?.id === boardId ? pickedBoard : null)) : null;

  const taskQuery: TaskQuery = { scope, status, boardId, text: get('q') };
  const queryKey = JSON.stringify([taskQuery, size]);

  // Jira pages forward with tokens; remember each visited page's token so Previous works.
  const [pager, setPager] = useState<{ key: string; tokens: (string | null)[]; index: number }>({
    key: '',
    tokens: [null],
    index: 0,
  });
  const current = pager.key === queryKey ? pager : { key: queryKey, tokens: [null], index: 0 };

  const paged = useAsync(
    (s) =>
      showAll || view === 'sprints'
        ? Promise.resolve(null)
        : api.tasksPage(creds, taskQuery, { token: current.tokens[current.index], size }, s),
    [creds, queryKey, current.index, showAll, view],
  );
  // Show all renders rows as each batch of 100 arrives instead of waiting for the whole list.
  const [partial, setPartial] = useState<{ key: string; tasks: Task[]; total: number | null } | null>(null);
  const everything = useAsync(
    (s) => {
      if (!showAll || view === 'sprints') return Promise.resolve(null);
      setPartial(null); // a new load starts from zero, not from the previous run's rows
      return api.tasksAll(creds, taskQuery, s, (tasks, total) => {
        if (!s.aborted) setPartial({ key: queryKey, tasks, total });
      });
    },
    [creds, queryKey, showAll, view],
  );
  const { loading, error, reload } = showAll ? everything : paged;
  const progress = showAll && everything.loading && partial?.key === queryKey ? partial : null;
  // While loading, live progress wins over the previous (stale) result.
  const data = showAll ? (progress ?? everything.data) : paged.data;

  // Status changes are applied locally right away (Jira has already accepted them).
  const [overrides, setOverrides] = useState<Record<string, { status: string; statusCategory: StatusCategory }>>({});
  const [createOpen, setCreateOpen] = useState(false);

  const nextToken = paged.data?.nextPageToken ?? null;
  const goNext = () =>
    nextToken &&
    setPager(() => {
      const tokens = [...current.tokens];
      tokens[current.index + 1] = nextToken;
      return { key: queryKey, tokens, index: current.index + 1 };
    });
  const goPrev = () => setPager({ ...current, index: Math.max(0, current.index - 1) });

  const rows: Task[] = (data?.tasks ?? []).map((t) => ({ ...t, ...overrides[t.key] }));
  const from = current.index * size + 1;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          scope === 'mine' ? 'Issues assigned to you across every project.' : 'All issues you can browse in Jira.'
        }
        badge={board ? `Board: ${board.name}` : undefined}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" /> Create task
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => v && set({ view: v === 'sprints' ? 'sprints' : null })}
          aria-label="View"
        >
          <ToggleGroupItem value="list">
            <ListIcon /> List
          </ToggleGroupItem>
          <ToggleGroupItem value="sprints">
            <SquareKanbanIcon /> Sprints
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={scope}
          onValueChange={(v) => v && set({ scope: v === 'mine' ? null : v })}
        >
          {SCOPES.map((s) => (
            <ToggleGroupItem key={s.id} value={s.id}>
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {view === 'list' && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={status}
            onValueChange={(v) => v && set({ status: v === 'open' ? null : v })}
          >
            {STATUSES.map((s) => (
              <ToggleGroupItem key={s.id} value={s.id}>
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <BoardPicker
          value={board}
          onChange={(b) => {
            setPickedBoard(b);
            set({ board: b?.id ?? null });
          }}
        />
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search key, title or description…"
            className="h-7 pl-8"
          />
        </div>
        {view === 'list' && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={showAll ? 'all' : 'paged'}
            onValueChange={(v) => v && set({ display: v === 'all' ? 'all' : null })}
            aria-label="Display"
          >
            <ToggleGroupItem value="paged" aria-label="Paged">
              <ListIcon /> Paged
            </ToggleGroupItem>
            <ToggleGroupItem value="all" aria-label="Show all on one page">
              <ListTreeIcon /> Show all
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOverrides({});
            if (view === 'sprints') setSprintReload((k) => k + 1);
            else reload();
          }}
          disabled={view === 'list' && loading}
        >
          <RefreshCwIcon className={cn(loading && 'animate-spin')} data-icon="inline-start" /> Refresh
        </Button>
      </div>

      {boardReq.error && <ErrorAlert error={boardReq.error} onRetry={boardReq.reload} />}
      {view === 'list' && error && <ErrorAlert error={error} onRetry={reload} />}

      {view === 'sprints' ? (
        <SprintView
          boardId={boardId}
          scope={scope}
          text={get('q')}
          onOpen={(key) => set({ issue: key })}
          reloadKey={sprintReload}
        />
      ) : (
        <Card className={cn('gap-0 py-0', loading && data && !progress && 'opacity-60 transition-opacity')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Key</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                {hasTester && <TableHead>Tester</TableHead>}
                <TableHead className="text-right" title={pointsName ?? 'Original estimate'}>
                  {pointsName ?? 'Estimate'}
                </TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="pr-4">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data &&
                loading &&
                Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns} className="px-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {rows.map((t) => {
                const overdue = t.dueDate && t.statusCategory !== 'done' && t.dueDate < today;
                return (
                  <TableRow key={t.key} className="cursor-pointer" onClick={() => set({ issue: t.key })}>
                    <TableCell className="pl-4">
                      <a
                        href={`${creds.site}/browse/${t.key}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-link hover:underline"
                      >
                        {t.key}
                      </a>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <span className="mr-1.5 text-xs text-muted-foreground">{t.issueType}</span>
                      {t.summary}
                      <div className="text-xs text-muted-foreground">{t.projectName}</div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <StatusMenu
                        issueKey={t.key}
                        status={t.status}
                        category={t.statusCategory}
                        onChanged={(s, c) => setOverrides((o) => ({ ...o, [t.key]: { status: s, statusCategory: c } }))}
                      />
                    </TableCell>
                    <TableCell>
                      {t.assignee ? (
                        <span className="flex items-center gap-2">
                          <PersonAvatar person={t.assignee} />
                          <span className="max-w-36 truncate">{t.assignee.displayName}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    {hasTester && (
                      <TableCell>
                        {t.testers.length ? (
                          <span
                            className="flex items-center gap-2"
                            title={t.testers.map((p) => p.displayName).join(', ')}
                          >
                            <PersonAvatar person={t.testers[0]} />
                            <span className="max-w-32 truncate">
                              {t.testers[0].displayName}
                              {t.testers.length > 1 && ` +${t.testers.length - 1}`}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums">
                      {pointsName ? (
                        <span className={cn(t.points === null && 'text-muted-foreground')}>
                          {formatPoints(t.points, pointsName)}
                        </span>
                      ) : t.estimateSeconds ? (
                        <>
                          <div>{formatDuration(t.estimateSeconds)}</div>
                          {t.remainingSeconds !== null && t.remainingSeconds !== t.estimateSeconds && (
                            <div className="text-xs text-muted-foreground">
                              {formatDuration(t.remainingSeconds)} left
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.priority ?? '—'}</TableCell>
                    <TableCell className={cn(overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {t.dueDate ? formatDay(t.dueDate, { weekday: undefined }) : '—'}
                    </TableCell>
                    <TableCell className="pr-4 text-muted-foreground">{relativeTime(t.updated)}</TableCell>
                  </TableRow>
                );
              })}
              {data && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns} className="h-24 text-center text-muted-foreground">
                    No tasks match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {progress && (
            <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              <span className="tabular-nums">
                Loading {progress.tasks.length.toLocaleString()}
                {progress.total !== null && ` of ~${Math.min(progress.total, SHOW_ALL_CAP).toLocaleString()}`} tasks…
              </span>
              <span className="text-xs">(switch to Paged for a faster first page)</span>
            </div>
          )}
          {showAll && !progress && everything.data && rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {everything.data.truncated
                  ? `Showing the first ${rows.length.toLocaleString()}${everything.data.total !== null ? ` of ~${everything.data.total.toLocaleString()}` : ''} tasks. Narrow the filters to see the rest.`
                  : `All ${rows.length.toLocaleString()} tasks`}
              </span>
            </div>
          )}
          {!showAll && paged.data && (rows.length > 0 || current.index > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <span className="text-sm text-muted-foreground tabular-nums">
                {rows.length ? `${from}–${from + rows.length - 1}` : '0'}
                {paged.data.total !== null &&
                  ` of ${paged.data.total >= 1000 ? '~' : ''}${paged.data.total.toLocaleString()}`}
              </span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  Rows
                  <Select value={String(size)} onValueChange={(v) => set({ size: v === '25' ? null : v })}>
                    <SelectTrigger size="sm" className="w-18" aria-label="Rows per page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZES.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={goPrev} disabled={current.index === 0 || loading}>
                  <ChevronLeftIcon data-icon="inline-start" /> Previous
                </Button>
                <span className="text-sm tabular-nums">Page {current.index + 1}</span>
                <Button variant="outline" size="sm" onClick={goNext} disabled={!nextToken || loading}>
                  Next <ChevronRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <TaskDetailsSheet
        issueKey={openIssue}
        onClose={() => set({ issue: null })}
        onChanged={() => {
          setOverrides({});
          if (view === 'sprints') setSprintReload((k) => k + 1);
          else reload();
        }}
      />

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultProjectKey={board?.projectKey}
        onCreated={() => {
          setOverrides({});
          setPager({ key: queryKey, tokens: [null], index: 0 });
          if (view === 'sprints') setSprintReload((k) => k + 1);
          else reload();
        }}
      />
    </>
  );
}
