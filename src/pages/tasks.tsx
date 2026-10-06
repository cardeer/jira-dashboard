import { useMemo } from 'react';
import { RefreshCwIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DataPagination } from '@/components/data-pagination';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { IssueStatusBadge } from '@/components/status-badge';
import { api } from '@/api';
import { formatDay, relativeTime } from '@/dates';
import { useSession } from '@/lib/session';
import { useSearchState, useUrlSearchInput } from '@/lib/use-search-state';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import type { TaskFilter } from '../../shared/types';

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done (30 days)' },
  { id: 'all', label: 'All' },
];
const ALL = '__all';

export function TasksPage() {
  const { creds } = useSession();
  const { get, set } = useSearchState();
  const status = (['open', 'done', 'all'].includes(get('status')) ? get('status') : 'open') as TaskFilter;
  const project = get('project');
  const page = Math.max(1, Number(get('page', '1')) || 1);
  const size = Number(get('size', '25')) || 25;
  const [query, setQuery] = useUrlSearchInput('q', { page: null });

  const { data, loading, error, reload } = useAsync((s) => api.tasks(creds, status, s), [creds, status]);

  const projects = useMemo(
    () => [...new Map((data ?? []).map((t) => [t.projectKey, t.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [data],
  );
  const q = get('q').toLowerCase();
  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (t) => (!project || t.projectKey === project) && (!q || t.key.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q)),
      ),
    [data, project, q],
  );
  const slice = rows.slice((page - 1) * size, page * size);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="My tasks" description="Issues assigned to you across every project." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={status}
          onValueChange={(v) => v && set({ status: v === 'open' ? null : v, page: null })}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id}>{f.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select value={project || ALL} onValueChange={(v) => set({ project: v === ALL ? null : v, page: null })}>
          <SelectTrigger size="sm" className="w-48" aria-label="Project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projects.map(([key, name]) => (
              <SelectItem key={key} value={key}>{name} ({key})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search key or summary…" className="h-7 pl-8" />
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCwIcon className={cn(loading && 'animate-spin')} data-icon="inline-start" /> Refresh
        </Button>
      </div>

      {error && <ErrorAlert error={error} onRetry={reload} />}

      <Card className={cn('gap-0 py-0', loading && data && 'opacity-60 transition-opacity')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Key</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
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
            {slice.map((t) => {
              const overdue = t.dueDate && t.statusCategory !== 'done' && t.dueDate < today;
              return (
                <TableRow key={t.key}>
                  <TableCell className="pl-4">
                    <a href={`${creds.site}/browse/${t.key}`} target="_blank" rel="noreferrer" className="font-medium text-link hover:underline">
                      {t.key}
                    </a>
                  </TableCell>
                  <TableCell className="max-w-md truncate whitespace-normal">
                    <span className="mr-1.5 text-xs text-muted-foreground">{t.issueType}</span>
                    {t.summary}
                  </TableCell>
                  <TableCell><span className="text-xs font-medium text-muted-foreground">{t.projectKey}</span></TableCell>
                  <TableCell><IssueStatusBadge status={t.status} category={t.statusCategory} /></TableCell>
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
        {data && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">{data.length} tasks assigned to you</span>
            <DataPagination
              page={page}
              size={size}
              total={rows.length}
              onPage={(p) => set({ page: p === 1 ? null : p })}
              onSize={(s) => set({ size: s === 25 ? null : s, page: null })}
            />
          </div>
        )}
      </Card>
    </>
  );
}
