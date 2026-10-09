import { useMemo, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DataPagination } from '@/components/data-pagination';
import { ErrorAlert } from '@/components/error-alert';
import { IssueStatusBadge, ReleaseStatusBadge } from '@/components/status-badge';
import { TaskDetailsSheet } from '@/components/task-details-sheet';
import { api } from '@/api';
import { daysFromToday, describeDays, formatDate } from '@/dates';
import { useSession } from '@/lib/session';
import { useSearchState } from '@/lib/use-search-state';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import { useDocumentTitle } from '@/lib/use-document-title';

export function ReleaseDetailPage() {
  const { creds } = useSession();
  const { projectKey = '', versionId = '' } = useParams();
  const location = useLocation();
  const { get, set } = useSearchState();
  const page = Math.max(1, Number(get('page', '1')) || 1);
  const size = Number(get('size', '25')) || 25;

  // Back returns to the list with the filters/page it was opened from.
  const from = (location.state as { from?: string } | null)?.from;
  const backTo = `/releases${from ?? `?project=${encodeURIComponent(projectKey)}`}`;

  const releaseReq = useAsync((s) => api.release(creds, versionId, s), [creds, versionId]);
  const issuesReq = useAsync((s) => api.releaseIssues(creds, versionId, s), [creds, versionId]);
  const r = releaseReq.data;
  useDocumentTitle(r ? `${r.name} · Releases` : 'Releases');
  const issues = issuesReq.data;

  const counts = useMemo(() => {
    const c = { done: 0, doing: 0, todo: 0 };
    for (const i of issues ?? []) {
      if (i.statusCategory === 'done') c.done++;
      else if (i.statusCategory === 'indeterminate') c.doing++;
      else c.todo++;
    }
    return c;
  }, [issues]);
  const total = issues?.length ?? 0;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const span = r?.startDate && r.releaseDate ? Math.max(daysFromToday(r.releaseDate) - daysFromToday(r.startDate), 0) : null;
  const slice = (issues ?? []).slice((page - 1) * size, page * size);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to={backTo}>
          <ArrowLeftIcon data-icon="inline-start" /> All releases
        </Link>
      </Button>

      {releaseReq.error && <ErrorAlert error={releaseReq.error} onRetry={releaseReq.reload} />}

      <Card className="mb-4">
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            {r ? (
              <>
                <CardTitle className="text-2xl">{r.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{r.projectKey}</span>
                  <span>{r.projectName}</span>
                  <ReleaseStatusBadge release={r} />
                </div>
                {r.description && <CardDescription className="max-w-prose whitespace-pre-line">{r.description}</CardDescription>}
              </>
            ) : (
              <>
                <Skeleton className="h-7 w-56" />
                <Skeleton className="h-4 w-40" />
              </>
            )}
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href={`${creds.site}/projects/${projectKey}/versions/${versionId}`} target="_blank" rel="noreferrer">
              Open in Jira <ExternalLinkIcon data-icon="inline-end" />
            </a>
          </Button>
        </CardHeader>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Start date" value={r ? (r.startDate ? formatDate(r.startDate) : '—') : null} />
        <Stat
          label="End (release) date"
          value={r ? (r.releaseDate ? formatDate(r.releaseDate) : '—') : null}
          sub={
            r?.releaseDate && !r.released ? (
              <span className={cn(r.overdue && 'font-medium text-destructive')}>{describeDays(daysFromToday(r.releaseDate))}</span>
            ) : undefined
          }
        />
        <Stat label="Duration" value={r ? (span === null ? '—' : `${span} day${span === 1 ? '' : 's'}`) : null} />
        <Stat label="Issues" value={issues ? String(total) : null} sub={issues && total > 0 ? `${counts.done} done` : undefined} />
      </div>

      {issuesReq.error && <ErrorAlert error={issuesReq.error} onRetry={issuesReq.reload} />}

      {issues && total > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="flex h-2.5 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`${counts.done} done, ${counts.doing} in progress, ${counts.todo} to do`}
            >
              <div className="bg-emerald-500" style={{ width: `${pct(counts.done)}%` }} />
              <div className="bg-blue-500" style={{ width: `${pct(counts.doing)}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <Legend className="bg-emerald-500" label={`Done ${counts.done} (${Math.round(pct(counts.done))}%)`} />
              <Legend className="bg-blue-500" label={`In progress ${counts.doing}`} />
              <Legend className="bg-muted-foreground/30" label={`To do ${counts.todo}`} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 py-0">
        <div className="border-b px-4 py-3 font-medium">Issues in this release</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Key</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead className="pr-4">Priority</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!issues &&
              !issuesReq.error &&
              Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5} className="px-4"><Skeleton className="h-5 w-full" /></TableCell>
                </TableRow>
              ))}
            {slice.map((i) => (
              <TableRow key={i.key} className="cursor-pointer" onClick={() => set({ issue: i.key })}>
                <TableCell className="pl-4">
                  <a
                    href={`${creds.site}/browse/${i.key}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-link hover:underline"
                  >
                    {i.key}
                  </a>
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  <span className="mr-1.5 text-xs text-muted-foreground">{i.issueType}</span>
                  {i.summary}
                </TableCell>
                <TableCell><IssueStatusBadge status={i.status} category={i.statusCategory} /></TableCell>
                <TableCell>{i.assignee ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                <TableCell className="pr-4 text-muted-foreground">{i.priority ?? '—'}</TableCell>
              </TableRow>
            ))}
            {issues && total === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No issues have this release as a Fix Version.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {total > 0 && (
          <div className="border-t px-4 py-3">
            <DataPagination
              page={page}
              size={size}
              total={total}
              onPage={(p) => set({ page: p === 1 ? null : p }, { replace: true })}
              onSize={(s) => set({ size: s === 25 ? null : s, page: null }, { replace: true })}
            />
          </div>
        )}
      </Card>

      <TaskDetailsSheet issueKey={get('issue') || null} onClose={() => set({ issue: null })} onChanged={issuesReq.reload} />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | null; sub?: ReactNode }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        {value === null ? <Skeleton className="h-6 w-28" /> : <CardTitle className="text-xl tabular-nums">{value}</CardTitle>}
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardHeader>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', className)} />
      {label}
    </span>
  );
}
