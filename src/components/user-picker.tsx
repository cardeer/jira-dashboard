import { useEffect, useState } from 'react';
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon, UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PersonAvatar } from '@/components/person-avatar';
import { api } from '@/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import type { Person } from '../../shared/types';

const RECENT_KEY = 'jira-dashboard.recentPeople';
const MAX_RECENT = 6;

function loadRecent(): Person[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveRecent(list: Person[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    /* not remembered */
  }
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Props {
  /** The person being viewed; null = me. */
  value: Person | null;
  onChange: (person: Person | null) => void;
}

/** Choose whose work logs to view: you, recent people, or anyone found by Jira user search. */
export function UserPicker({ value, onChange }: Props) {
  const { me, creds } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<Person[]>(loadRecent);
  const q = useDebounced(query.trim(), 300);
  const { data, loading, error } = useAsync(
    (s) => (open && q.length >= 2 ? api.searchUsers(creds, q, s) : Promise.resolve(null)),
    [creds, q, open],
  );

  const current = value ?? me;
  const isMe = current.accountId === me.accountId;

  function pick(p: Person) {
    if (p.accountId === me.accountId) onChange(null);
    else {
      const next = [p, ...recent.filter((r) => r.accountId !== p.accountId)];
      setRecent(next);
      saveRecent(next);
      onChange(p);
    }
    setOpen(false);
    setQuery('');
  }

  const item = (p: Person, note?: string) => (
    <CommandItem key={p.accountId} value={p.accountId} onSelect={() => pick(p)} className="gap-2">
      <PersonAvatar person={p} />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {p.displayName}
          {note && <span className="ml-1.5 text-xs text-muted-foreground">{note}</span>}
        </div>
        {p.email && <div className="truncate text-xs text-muted-foreground">{p.email}</div>}
      </div>
      <CheckIcon className={cn(current.accountId === p.accountId ? 'opacity-100' : 'opacity-0')} />
    </CommandItem>
  );

  const others = recent.filter((r) => r.accountId !== me.accountId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Whose work logs" className="max-w-64 justify-between gap-2 font-normal">
          <PersonAvatar person={current} className="size-5" />
          <span className="truncate">{isMe ? 'My work logs' : current.displayName}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search people by name or email…" />
          <CommandList>
            {q.length < 2 ? (
              <>
                <CommandGroup heading="You">{item(me, '(me)')}</CommandGroup>
                {others.length > 0 && <CommandGroup heading="Recent">{others.map((p) => item(p))}</CommandGroup>}
                <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                  <UsersIcon className="size-3.5" /> Type at least 2 letters to find a teammate.
                </div>
              </>
            ) : (
              <>
                {loading && !data && (
                  <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" /> Searching people…
                  </div>
                )}
                {error && (
                  <div className="p-3 text-sm text-destructive">
                    {error.status === 403
                      ? 'Your Jira account isn’t allowed to search users (needs “Browse users and groups”).'
                      : error.message}
                  </div>
                )}
                {data && <CommandEmpty>No people found.</CommandEmpty>}
                {data && data.length > 0 && <CommandGroup heading="People">{data.map((p) => item(p))}</CommandGroup>}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
