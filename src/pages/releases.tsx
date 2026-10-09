import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
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
import { ReleaseStatusBadge } from '@/components/status-badge';
import { api, type ReleaseOrder, type ReleaseStatus } from '@/api';
import { daysFromToday, describeDays, formatDate } from '@/dates';
import { useSession } from '@/lib/session';
import { useSearchState, useUrlSearchInput } from '@/lib/use-search-state';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import { useDocumentTitle } from '@/lib/use-document-title';

const STATUSES: { id: ReleaseStatus; label: string }[] = [
  { id: 'unreleased', label: 'Unreleased' },
  { id: 'released', label: 'Released' },
  { id: 'all', label: 'All' },
];
const SORTS: { id: ReleaseOrder; label: string }[] = [
  { id: 'releaseDate', label: 'Release date: soonest first' },
  { id: '-releaseDate', label: 'Release date: latest first' },
  { id: 'startDate', label: 'Start date: oldest first' },
  { id: '-startDate', label: 'Start date: newest first' },
  { id: 'name', label: 'Name A–Z' },
];
const PROJECT_KEY = 'jira-dashboard.releaseProject';

function rememberedProject() {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function ReleasesPage() {
  const { creds } = useSession();
  useDocumentTitle('Releases');
  const navigate = useNavigate();
  const location = useLocation();
  const { get, set } = useSearchState();

  const status = (STATUSES.some((s) => s.id === get('status')) ? get('status') : 'unreleased') as ReleaseStatus;
  const sortParam = get('sort') as ReleaseOrder;
  const orderBy: ReleaseOrder = SORTS.some((s) => s.id === sortParam)
    ? sortParam
    : status === 'unreleased'
      ? 'releaseDate'
      : '-releaseDate';
  const page = Math.max(1, Number(get('page', '1')) || 1);
  const size = Number(get('size', '25')) || 25;
  const [query, setQuery] = useUrlSearchInput('q', { page: null });

  const projectsReq = useAsync((s) => api.projects(creds, s), [creds]);
  const projectKey = get('project') || rememberedProject();
  const project = useMemo(() => {
    const list = projectsReq.data ?? [];
    return list.find((p) => p.key === projectKey) ?? list[0] ?? null;
  }, [projectsReq.data, projectKey]);

  // Put the effective project in the URL so the address is always shareable.
  useEffect(() => {
    if (project && get('project') !== project.key) set({ project: project.key }, { replace: true });
  }, [project, get, set]);

  const q = get('q');
  const releasesReq = useAsync(
    (s) =>
      project
        ? api.releasePage(creds, { project, status, query: q, orderBy, page, pageSize: size }, s)
        : Promise.resolve(null),
    [creds, project?.key, status, q, orderBy, page, size],
  );

  function chooseProject(key: string) {
    try {
      localStorage.setItem(PROJECT_KEY, key);
    } catch {
      /* not remembered */
    }
    set({ project: key, page: null });
  }

  const error = projectsReq.error ?? releasesReq.error;
  const reload = projectsReq.error ? projectsReq.reload : releasesReq.reload;
  const result = releasesReq.data;
  const showSkeleton = !result && !error;

  return (
    <>
      <PageHeader title="Releases" description="Release versions with their start and end dates. Select one to see its issues." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={project?.key ?? ''} onValueChange={chooseProject} disabled={!projectsReq.data}>
          <SelectTrigger size="sm" className="w-56" aria-label="Project">
            <SelectValue placeholder="Loading projects…" />
          </SelectTrigger>
          <SelectContent>
            {(projectsReq.data ?? []).map((p) => (
              <SelectItem key={p.key} value={p.key}>{p.name} ({p.key})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={status}
          onValueChange={(v) => v && set({ status: v === 'unreleased' ? null : v, page: null })}
        >
          {STATUSES.map((s) => (
            <ToggleGroupItem key={s.id} value={s.id}>{s.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select value={orderBy} onValueChange={(v) => set({ sort: v, page: null })}>
          <SelectTrigger size="sm" className="w-56" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search releases…" className="h-7 pl-8" />
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={releasesReq.loading}>
          <RefreshCwIcon className={cn(releasesReq.loading && 'animate-spin')} data-icon="inline-start" /> Refresh
        </Button>
      </div>

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {projectsReq.data && !project && <p className="text-sm text-muted-foreground">No projects found.</p>}

      {(result || showSkeleton) && (
        <Card className={cn('gap-0 py-0', releasesReq.loading && result && 'opacity-60 transition-opacity')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Release</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start date</TableHead>
                <TableHead className="pr-4">End (release) date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {showSkeleton &&
                Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4} className="px-4"><Skeleton className="h-5 w-full" /></TableCell>
                  </TableRow>
                ))}
              {result?.releases.map((r) => {
                const href = `/releases/${encodeURIComponent(r.projectKey)}/${r.id}`;
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(href, { state: { from: location.search } })}
                  >
                    <TableCell className="pl-4">
                      <div className="font-medium text-link">{r.name}</div>
                      {r.description && <div className="max-w-md truncate text-xs text-muted-foreground">{r.description}</div>}
                    </TableCell>
                    <TableCell><ReleaseStatusBadge release={r} /></TableCell>
                    <TableCell>{r.startDate ? formatDate(r.startDate) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="pr-4">
                      {r.releaseDate ? (
                        <>
                          <div>{formatDate(r.releaseDate)}</div>
                          {!r.released && (
                            <div className={cn('text-xs', r.overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                              {describeDays(daysFromToday(r.releaseDate))}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {result && result.releases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No releases match.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {result && result.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <span className="text-sm text-muted-foreground">{project?.name}</span>
              <DataPagination
                page={page}
                size={size}
                total={result.total}
                onPage={(p) => set({ page: p === 1 ? null : p })}
                onSize={(s) => set({ size: s === 25 ? null : s, page: null })}
              />
            </div>
          )}
        </Card>
      )}
    </>
  );
}
