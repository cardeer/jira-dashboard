import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { AlertCircleIcon, CheckIcon, ChevronsUpDownIcon, Loader2Icon, UserXIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PersonAvatar } from '@/components/person-avatar';
import { api, ApiError } from '@/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import type { Person } from '../../../shared/types';

const LAST_PROJECT_KEY = 'jira-dashboard.lastCreateProject';
const remembered = () => {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) ?? '';
  } catch {
    return '';
  }
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected project (e.g. the selected board's project). */
  defaultProjectKey?: string;
  onCreated: (key: string) => void;
}

/** Assignee: me (default), unassigned, or anyone assignable in the project. */
type Assignee = { kind: 'me' } | { kind: 'none' } | { kind: 'user'; person: Person };

export function CreateTaskDialog({ open, onOpenChange, defaultProjectKey, onCreated }: Props) {
  const { creds, me, onUnauthorized } = useSession();
  const [projectKey, setProjectKey] = useState('');
  const [issueTypeId, setIssueTypeId] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState<Assignee>({ kind: 'me' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const projectsReq = useAsync((s) => (open ? api.projects(creds, s) : Promise.resolve(null)), [creds, open]);
  const typesReq = useAsync(
    (s) => (open && projectKey ? api.issueTypes(creds, projectKey, s) : Promise.resolve(null)),
    [creds, open, projectKey],
  );

  // Fresh form each time it opens; keep the project choice sensible.
  useEffect(() => {
    if (!open) return;
    setSummary('');
    setDescription('');
    setAssignee({ kind: 'me' });
    setError('');
    setProjectKey(defaultProjectKey || remembered());
  }, [open, defaultProjectKey]);

  // Fall back to the first project when nothing (valid) is pre-selected.
  useEffect(() => {
    const list = projectsReq.data;
    if (list?.length && !list.some((p) => p.key === projectKey)) setProjectKey(list[0].key);
  }, [projectsReq.data, projectKey]);

  // Prefer "Task" when the project has it.
  useEffect(() => {
    const types = typesReq.data;
    if (!types?.length) return;
    if (!types.some((t) => t.id === issueTypeId)) setIssueTypeId((types.find((t) => t.name === 'Task') ?? types[0]).id);
  }, [typesReq.data, issueTypeId]);

  const valid = Boolean(projectKey && issueTypeId && summary.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError('');
    try {
      const { key } = await api.createIssue(creds, {
        projectKey,
        issueTypeId,
        summary,
        description,
        assigneeId: assignee.kind === 'me' ? me.accountId : assignee.kind === 'user' ? assignee.person.accountId : null,
      });
      try {
        localStorage.setItem(LAST_PROJECT_KEY, projectKey);
      } catch {
        /* not remembered */
      }
      toast.success(`Created ${key}`, {
        description: summary.trim(),
        action: { label: 'Open', onClick: () => window.open(`${creds.site}/browse/${key}`, '_blank', 'noreferrer') },
      });
      onOpenChange(false);
      onCreated(key);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid min-w-0 grid-cols-1 gap-5">
          <DialogHeader>
            <DialogTitle>Create task</DialogTitle>
            <DialogDescription>Creates a new issue in Jira.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <Label>Project</Label>
              <Select value={projectKey} onValueChange={setProjectKey} disabled={!projectsReq.data}>
                <SelectTrigger className="w-full min-w-0" aria-label="Project">
                  <SelectValue placeholder="Loading projects…" />
                </SelectTrigger>
                <SelectContent>
                  {(projectsReq.data ?? []).map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.name} ({p.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label>Issue type</Label>
              <Select value={issueTypeId} onValueChange={setIssueTypeId} disabled={!typesReq.data}>
                <SelectTrigger className="w-full min-w-0" aria-label="Issue type">
                  <SelectValue placeholder={projectKey ? 'Loading types…' : 'Pick a project'} />
                </SelectTrigger>
                <SelectContent>
                  {(typesReq.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.iconUrl && <img src={t.iconUrl} alt="" className="size-4" />}
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {typesReq.error && <p className="-mt-3 text-xs text-destructive">{typesReq.error.message}</p>}

          <div className="grid gap-1.5">
            <Label htmlFor="task-summary">Summary</Label>
            <Input id="task-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What needs to be done?" required autoFocus />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="task-description">Description</Label>
            <Textarea id="task-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Optional details" />
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label>Assignee</Label>
            <AssigneePicker projectKey={projectKey} value={assignee} onChange={setAssignee} />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function AssigneePicker({ projectKey, value, onChange }: { projectKey: string; value: Assignee; onChange: (a: Assignee) => void }) {
  const { creds, me } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const { data, loading, error } = useAsync(
    (s) => (open && projectKey ? api.assignableUsers(creds, projectKey, q, s) : Promise.resolve(null)),
    [creds, open, projectKey, q],
  );

  const pick = (a: Assignee) => {
    onChange(a);
    setOpen(false);
    setQuery('');
  };
  const people = (data ?? []).filter((p) => p.accountId !== me.accountId);
  const label =
    value.kind === 'me' ? (
      <>
        <PersonAvatar person={me} className="size-5" /> {me.displayName} (me)
      </>
    ) : value.kind === 'none' ? (
      <>
        <UserXIcon className="text-muted-foreground" /> Unassigned
      </>
    ) : (
      <>
        <PersonAvatar person={value.person} className="size-5" /> {value.person.displayName}
      </>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Assignee" className="w-full min-w-0 justify-between font-normal">
          <span className="flex min-w-0 items-center gap-2 truncate">{label}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search assignable people…" />
          <CommandList>
            {!q && (
              <CommandGroup>
                <CommandItem value="__me" onSelect={() => pick({ kind: 'me' })} className="gap-2">
                  <PersonAvatar person={me} />
                  <span className="flex-1">{me.displayName} (me)</span>
                  <CheckIcon className={cn(value.kind === 'me' ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
                <CommandItem value="__none" onSelect={() => pick({ kind: 'none' })} className="gap-2">
                  <UserXIcon className="text-muted-foreground" />
                  <span className="flex-1">Unassigned</span>
                  <CheckIcon className={cn(value.kind === 'none' ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              </CommandGroup>
            )}
            {loading && !data && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Loading people…
              </div>
            )}
            {error && <div className="p-3 text-sm text-destructive">{error.message}</div>}
            {data && q && people.length === 0 && <CommandEmpty>No assignable people found.</CommandEmpty>}
            {people.length > 0 && (
              <CommandGroup heading="People">
                {people.map((p) => (
                  <CommandItem key={p.accountId} value={p.accountId} onSelect={() => pick({ kind: 'user', person: p })} className="gap-2">
                    <PersonAvatar person={p} />
                    <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
                    <CheckIcon
                      className={cn(value.kind === 'user' && value.person.accountId === p.accountId ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
