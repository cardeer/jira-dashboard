import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDownIcon, Loader2Icon } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { IssueStatusBadge } from '@/components/status-badge';
import { api, ApiError, type Transition } from '@/api';
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

const GROUPS: { category: StatusCategory; label: string }[] = [
  { category: 'new', label: 'To do' },
  { category: 'indeterminate', label: 'In progress' },
  { category: 'done', label: 'Done' },
  { category: 'unknown', label: 'Other' },
];
/** Show a search box only when the workflow offers enough moves to need one. */
const SEARCH_THRESHOLD = 7;

/** Status badge that opens the issue's available workflow transitions, grouped and searchable. */
export function StatusMenu({ issueKey, status, category, onChanged }: Props) {
  const { creds, onUnauthorized } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Transitions depend on the current status, so refetch whenever the menu opens.
  const { data, loading, error } = useAsync(
    (s) => (open ? api.transitions(creds, issueKey, s) : Promise.resolve(null)),
    [creds, issueKey, open, status],
  );

  async function move(t: Transition) {
    setOpen(false);
    setBusy(true);
    try {
      await api.transitionIssue(creds, issueKey, t.id);
      onChanged(t.to.name, t.to.statusCategory);
      toast.success(`${issueKey} → ${t.to.name}`);
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

  const grouped = GROUPS.map((g) => ({
    ...g,
    items: (data ?? [])
      .filter((t) => t.to.statusCategory === g.category)
      .sort((a, b) => a.to.name.localeCompare(b.to.name) || a.name.localeCompare(b.name)),
  })).filter((g) => g.items.length > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex max-w-full items-center gap-0.5 rounded-4xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        disabled={busy}
        aria-label={`Status: ${status}. Change status`}
      >
        <IssueStatusBadge status={status} category={category} />
        {busy ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground">
            <span className="shrink-0">Move {issueKey} from</span>
            <IssueStatusBadge status={status} category={category} className="min-w-0" />
          </div>
          {data && data.length >= SEARCH_THRESHOLD && <CommandInput placeholder="Search statuses…" />}
          <CommandList className="max-h-80">
            {loading && !data && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Loading transitions…
              </div>
            )}
            {error && <div className="p-3 text-sm text-destructive">{error.message}</div>}
            {data && <CommandEmpty>{data.length ? 'No matching status.' : 'No transitions available.'}</CommandEmpty>}
            {grouped.map((g) => (
              <CommandGroup key={g.category} heading={g.label}>
                {g.items.map((t) => (
                  <CommandItem
                    key={t.id}
                    // Searchable by both the target status and the transition's own name.
                    value={`${t.to.name} ${t.name} ${t.id}`}
                    onSelect={() => move(t)}
                    className="gap-3"
                  >
                    <IssueStatusBadge status={t.to.name} category={t.to.statusCategory} className="min-w-0 shrink" />
                    {t.name.toLowerCase() !== t.to.name.toLowerCase() && (
                      <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground" title={t.name}>
                        {t.name}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
