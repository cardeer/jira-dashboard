import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, ListIcon, ListTreeIcon, PlusIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
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
import { api, type Board, type TaskQuery } from '@/api';
import { formatDay, relativeTime } from '@/dates';
import { useSession } from '@/lib/session';
import { useSearchState, useUrlSearchInput } from '@/lib/use-search-state';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import type { StatusCategory, Task, TaskFilter, TaskScope } from '../../../shared/types';
import { CreateTaskDialog } from './create-task-dialog';

const SCOPES: { id: TaskScope; label: string }[] = [
  { id: 'mine', label: 'Assigned to me' },
  { id: 'all', label: 'All tasks' },
];
const STATUSES: { id: TaskFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done (30 days)' },
  { id: 'all', label: 'All' },
];

export function TasksPage() {
  const { creds } = useSession();
  const { get, set } = useSearchState();

  // URL: ?scope=all&status=done&board=<id>&q=<text>
  const scope = (get('scope') === 'all' ? 'all' : 'mine') as TaskScope;
  const status = (['open', 'done', 'all'].includes(get('status')) ? get('status') : 'open') as TaskFilter;
  const boardId = /^\d+$/.test(get('board')) ? get('board') : null;
  const size = PAGE_SIZES.includes(Number(get('size'))) ? Number(get('size')) : 25;
  // ?display=all shows every matching task on one page; default is paged.
  const showAll = get('display') === 'all';
  const [query, setQuery] = useUrlSearchInput('q');

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
    (s) => (showAll ? Promise.resolve(null) : api.tasksPage(creds, taskQuery, { token: current.tokens[current.index], size }, s)),
    [creds, queryKey, current.index, showAll],
  );
  const everything = useAsync(
    (s) => (showAll ? api.tasksAll(creds, taskQuery, s) : Promise.resolve(null)),
    [creds, queryKey, showAll],
  );
  const { loading, error, reload } = showAll ? everything : paged;
  const data = showAll ? everything.data : paged.data;

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
        description={scope === 'mine' ? 'Issues assigned to you across every project.' : 'All issues you can browse in Jira.'}
        badge={board ? `Board: ${board.name}` : undefined}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" /> Create task
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={scope} onValueChange={(v) => v && set({ scope: v === 'mine' ? null : v })}>
          {SCOPES.map((s) => (
            <ToggleGroupItem key={s.id} value={s.id}>{s.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && set({ status: v === 'open' ? null : v })}>
          {STATUSES.map((s) => (
            <ToggleGroupItem key={s.id} value={s.id}>{s.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <BoardPicker
          value={board}
          onChange={(b) => {
            setPickedBoard(b);
            set({ board: b?.id ?? null });
          }}
        />
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search key, title or description…" className="h-7 pl-8" />
        </div>
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOverrides({});
            reload();
          }}
          disabled={loading}
        >
          <RefreshCwIcon className={cn(loading && 'animate-spin')} data-icon="inline-start" /> Refresh
        </Button>
      </div>

      {boardReq.error && <ErrorAlert error={boardReq.error} onRetry={boardReq.reload} />}
      {error && <ErrorAlert error={error} onRetry={reload} />}

      <Card className={cn('gap-0 py-0', loading && data && 'opacity-60 transition-opacity')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Key</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assignee</TableHead>
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
                  <TableCell colSpan={7} className="px-4"><Skeleton className="h-5 w-full" /></TableCell>
                </TableRow>
              ))}
            {rows.map((t) => {
              const overdue = t.dueDate && t.statusCategory !== 'done' && t.dueDate < today;
              return (
                <TableRow key={t.key}>
                  <TableCell className="pl-4">
                    <a href={`${creds.site}/browse/${t.key}`} target="_blank" rel="noreferrer" className="font-medium text-link hover:underline">
                      {t.key}
                    </a>
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    <span className="mr-1.5 text-xs text-muted-foreground">{t.issueType}</span>
                    {t.summary}
                    <div className="text-xs text-muted-foreground">{t.projectName}</div>
                  </TableCell>
                  <TableCell>
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
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No tasks match.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {showAll && everything.data && rows.length > 0 && (
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
              {paged.data.total !== null && ` of ${paged.data.total >= 1000 ? '~' : ''}${paged.data.total.toLocaleString()}`}
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
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
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

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultProjectKey={board?.projectKey}
        onCreated={() => {
          setOverrides({});
          setPager({ key: queryKey, tokens: [null], index: 0 });
          reload();
        }}
      />
    </>
  );
}
