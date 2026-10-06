import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Release, StatusCategory } from '../../shared/types';

const TONE = {
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  progress: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  todo: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive/15 text-destructive',
};

/** Jira issue status, coloured by its status category like Jira does. */
export function IssueStatusBadge({ status, category }: { status: string; category: StatusCategory }) {
  const tone = category === 'done' ? TONE.done : category === 'indeterminate' ? TONE.progress : TONE.todo;
  return <Badge className={cn('uppercase tracking-wide', tone)}>{status}</Badge>;
}

export type ReleaseState = 'released' | 'overdue' | 'unreleased' | 'archived';

export const releaseState = (r: Release): ReleaseState =>
  r.archived ? 'archived' : r.released ? 'released' : r.overdue ? 'overdue' : 'unreleased';

export function ReleaseStatusBadge({ release }: { release: Release }) {
  const s = releaseState(release);
  const tone = { released: TONE.done, overdue: TONE.danger, unreleased: TONE.progress, archived: TONE.todo }[s];
  return <Badge className={cn('uppercase tracking-wide', tone)}>{s}</Badge>;
}
