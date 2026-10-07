import { useEffect, useState } from 'react';
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon, UserXIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PersonAvatar } from '@/components/person-avatar';
import { api } from '@/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import type { Person } from '../../shared/types';

/** Assignee choice: me, unassigned, or anyone assignable in the project. */
export type Assignee = { kind: 'me' } | { kind: 'none' } | { kind: 'user'; person: Person };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Assignee combobox: me, unassigned, or a search of people assignable in `projectKey`. */
export function AssigneePicker({ projectKey, value, onChange }: { projectKey: string; value: Assignee; onChange: (a: Assignee) => void }) {
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
