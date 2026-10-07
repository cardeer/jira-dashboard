import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, SquareKanbanIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/error-alert';
import { PersonAvatar } from '@/components/person-avatar';
import { StatusMenu } from '@/components/status-menu';
import { api, type SprintSection } from '@/api';
import { formatDate, formatDuration } from '@/dates';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { formatPoints } from '@/lib/points';
import { useAsync } from '@/useAsync';
import type { StatusCategory, TaskScope } from '../../../shared/types';

interface Props {
  boardId: string | null;
  /** Narrow issues: assigned to me / all, and free-text search (keys work without prefix). */
  scope: TaskScope;
  text: string;
  onOpen: (key: string) => void;
  /** Bumped by the parent to force a reload (e.g. after edits in the details panel). */
  reloadKey: number;
}

/** A board's active sprint(s), future sprints and backlog, like Jira's backlog view. */
export function SprintView({ boardId, scope, text, onOpen, reloadKey }: Props) {
  const { creds } = useSession();
  const { data, loading, error, reload } = useAsync(
    (s) => (boardId ? api.sprintBoard(creds, boardId, { scope, text }, s) : Promise.resolve(null)),
    [creds, boardId, scope, text, reloadKey],
  );
  const [overrides, setOverrides] = useState<Record<string, { status: string; statusCategory: StatusCategory }>>({});
  const fieldIds = useAsync((s) => api.customFieldIds(creds).then((ids) => (s.aborted ? null : ids)), [creds]);
  const pointsName = fieldIds.data?.storyPoints ? (fieldIds.data.storyPointsName ?? 'Story points') : null;

  if (!boardId) {
    return (
      <Card className="flex flex-col items-center gap-2 p-10 text-center">
        <SquareKanbanIcon className="size-8 text-muted-foreground" />
        <p className="font-medium">Pick a board to see its sprints and backlog</p>
        <p className="text-sm text-muted-foreground">Use the board filter above, e.g. your team’s Scrum board.</p>
      </Card>
    );
  }
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) {
    return (
      <div className="grid gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid gap-3', loading && 'opacity-60 transition-opacity')}>
      {data.length === 1 && data[0].state === 'backlog' && (
        <p className="text-sm text-muted-foreground">
          This board has no active or upcoming sprints (Kanban boards don’t use sprints).
        </p>
      )}
      {data.map((section) => (
        <Section
          key={section.id}
          section={section}
          overrides={overrides}
          pointsName={pointsName}
          onOpen={onOpen}
          onStatus={(key, status, statusCategory) => setOverrides((o) => ({ ...o, [key]: { status, statusCategory } }))}
        />
      ))}
    </div>
  );
}

function Section({
  section: s,
  overrides,
  pointsName,
  onOpen,
  onStatus,
}: {
  section: SprintSection;
  overrides: Record<string, { status: string; statusCategory: StatusCategory }>;
  /** Name of the site's estimate field (e.g. "Estimate Working Hour"); null = use time estimates. */
  pointsName: string | null;
  onOpen: (key: string) => void;
  onStatus: (key: string, status: string, category: StatusCategory) => void;
}) {
  // Active sprint and backlog open; future sprints start collapsed to keep the page short.
  const [open, setOpen] = useState(s.state !== 'future');
  const tasks = s.tasks.map((t) => ({ ...t, ...overrides[t.key] }));
  const done = tasks.filter((t) => t.statusCategory === 'done').length;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted/50"
        aria-expanded={open}
      >
        {open ? <ChevronDownIcon className="size-4 shrink-0" /> : <ChevronRightIcon className="size-4 shrink-0" />}
        <span className="font-semibold">{s.name}</span>
        {s.state === 'active' && <Badge>Active</Badge>}
        {s.state === 'future' && <Badge variant="secondary">Upcoming</Badge>}
        {(s.startDate || s.endDate) && (
          <span className="text-sm text-muted-foreground">
            {s.startDate ? formatDate(s.startDate.slice(0, 10)) : '?'} –{' '}
            {s.endDate ? formatDate(s.endDate.slice(0, 10)) : '?'}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-sm text-muted-foreground tabular-nums">
          <span>
            {tasks.length} issue{tasks.length === 1 ? '' : 's'}
            {tasks.length > 0 && s.state !== 'backlog' && ` · ${done} done`}
          </span>
          {s.storyPoints !== null && (
            <span title={pointsName ?? undefined}>{formatPoints(s.storyPoints, pointsName)}</span>
          )}
          {!pointsName && s.estimateSeconds > 0 && <span>{formatDuration(s.estimateSeconds)} est.</span>}
        </span>
        {s.goal && <p className="w-full pl-7 text-sm text-muted-foreground">🎯 {s.goal}</p>}
      </button>
      {open && (
        <div className="border-t">
          {tasks.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No issues.</p>
          ) : (
            tasks.map((t) => (
              <div
                key={t.key}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(t.key)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(t.key)}
                className="flex cursor-pointer items-center gap-3 border-b px-4 py-2 text-sm last:border-b-0 hover:bg-muted/50"
              >
                <span className="w-20 shrink-0 font-medium text-link">{t.key}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="mr-1.5 text-xs text-muted-foreground">{t.issueType}</span>
                  {t.summary}
                </span>
                <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                  <StatusMenu
                    issueKey={t.key}
                    status={t.status}
                    category={t.statusCategory}
                    onChanged={(st, c) => onStatus(t.key, st, c)}
                  />
                </span>
                <span
                  className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
                  title={pointsName ?? 'Original estimate'}
                >
                  {pointsName
                    ? formatPoints(t.points, pointsName)
                    : t.estimateSeconds
                      ? formatDuration(t.estimateSeconds)
                      : '—'}
                </span>
                <span className="w-8 shrink-0" title={`Assignee: ${t.assignee?.displayName ?? 'Unassigned'}`}>
                  {t.assignee ? (
                    <PersonAvatar person={t.assignee} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </span>
                {t.testers.length > 0 && (
                  <span
                    className="flex shrink-0 -space-x-1.5"
                    title={`Tester: ${t.testers.map((p) => p.displayName).join(', ')}`}
                  >
                    {t.testers.slice(0, 2).map((p) => (
                      <PersonAvatar key={p.accountId} person={p} className="ring-2 ring-card" />
                    ))}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
