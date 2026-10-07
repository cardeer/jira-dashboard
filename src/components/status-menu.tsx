import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightIcon, ChevronDownIcon, Loader2Icon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IssueStatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/api';
import { useSession } from '@/lib/session';
import { useAsync } from '@/useAsync';
import type { StatusCategory } from '../../shared/types';

interface Props {
  issueKey: string;
  status: string;
  category: StatusCategory;
  /** Called after Jira accepted the transition, with the new status. */
  onChanged: (status: string, category: StatusCategory) => void;
}

/** Status badge that opens the issue's available workflow transitions. */
export function StatusMenu({ issueKey, status, category, onChanged }: Props) {
  const { creds, onUnauthorized } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Transitions depend on the current status, so refetch whenever the menu opens.
  const { data, loading, error } = useAsync(
    (s) => (open ? api.transitions(creds, issueKey, s) : Promise.resolve(null)),
    [creds, issueKey, open, status],
  );

  async function move(id: string, to: { name: string; statusCategory: StatusCategory }) {
    setBusy(true);
    try {
      await api.transitionIssue(creds, issueKey, id);
      onChanged(to.name, to.statusCategory);
      toast.success(`${issueKey} → ${to.name}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      toast.error(`Couldn’t move ${issueKey}`, {
        description:
          (e as Error).message +
          (e instanceof ApiError && e.status === 400 ? ' (this transition may need fields set in Jira, e.g. a resolution)' : ''),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-0.5 rounded-4xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        disabled={busy}
        aria-label={`Status: ${status}. Change status`}
      >
        <IssueStatusBadge status={status} category={category} />
        {busy ? <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" /> : <ChevronDownIcon className="size-3.5 text-muted-foreground" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Move {issueKey} to…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading && !data && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Loading…
          </div>
        )}
        {error && <div className="px-2 py-1.5 text-sm text-destructive">{error.message}</div>}
        {data?.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No transitions available.</div>}
        {data?.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => move(t.id, t.to)} className="justify-between gap-3">
            {t.name !== t.to.name ? (
              <>
                <span>{t.name}</span>
                <span className="flex items-center gap-1">
                  <ArrowRightIcon className="size-3 text-muted-foreground" />
                  <IssueStatusBadge status={t.to.name} category={t.to.statusCategory} />
                </span>
              </>
            ) : (
              <IssueStatusBadge status={t.to.name} category={t.to.statusCategory} />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
