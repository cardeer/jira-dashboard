import { useEffect, useState } from 'react';
import { CheckIcon, ChevronsUpDownIcon, SquareKanbanIcon, LayersIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api, type Board } from '@/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';

const RECENT_KEY = 'jira-dashboard.recentBoards';
const MAX_RECENT = 6;

function loadRecent(): Board[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveRecent(list: Board[]) {
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
  /** Selected board; null = all boards (no filter). */
  value: Board | null;
  onChange: (board: Board | null) => void;
}

/** Filter work logs to one Jira board's issues (a team's board). */
export function BoardPicker({ value, onChange }: Props) {
  const { creds } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<Board[]>(loadRecent);
  const q = useDebounced(query.trim(), 300);
  const { data, loading, error } = useAsync(
    (s) => (open ? api.boards(creds, q, s) : Promise.resolve(null)),
    [creds, q, open],
  );

  function pick(b: Board | null) {
    if (b) {
      const next = [b, ...recent.filter((r) => r.id !== b.id)];
      setRecent(next);
      saveRecent(next);
    }
    onChange(b);
    setOpen(false);
    setQuery('');
  }

  const item = (b: Board) => (
    <CommandItem key={b.id} value={b.id} onSelect={() => pick(b)} className="gap-2">
      <SquareKanbanIcon className="text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{b.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[b.location, b.type].filter(Boolean).join(' · ')}
        </div>
      </div>
      <CheckIcon className={cn(value?.id === b.id ? 'opacity-100' : 'opacity-0')} />
    </CommandItem>
  );

  const recentShown = q ? [] : recent;
  const results = (data ?? []).filter((b) => !recentShown.some((r) => r.id === b.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Board" className="max-w-64 justify-between gap-2 font-normal">
          {value ? <SquareKanbanIcon className="text-muted-foreground" /> : <LayersIcon className="text-muted-foreground" />}
          <span className="truncate">{value ? value.name : 'All boards'}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search boards…" />
          <CommandList>
            {!q && (
              <CommandGroup>
                <CommandItem value="__all" onSelect={() => pick(null)} className="gap-2">
                  <LayersIcon className="text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div>All boards</div>
                    <div className="text-xs text-muted-foreground">No board filter</div>
                  </div>
                  <CheckIcon className={cn(!value ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              </CommandGroup>
            )}
            {recentShown.length > 0 && <CommandGroup heading="Recent">{recentShown.map(item)}</CommandGroup>}
            {loading && !data && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Loading boards…
              </div>
            )}
            {error && <div className="p-3 text-sm text-destructive">{error.message}</div>}
            {data && q && results.length === 0 && <CommandEmpty>No boards found.</CommandEmpty>}
            {results.length > 0 && <CommandGroup heading={q ? 'Boards' : 'All boards'}>{results.map(item)}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
