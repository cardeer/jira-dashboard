import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { AlertCircleIcon, CalendarIcon, CheckIcon, ChevronsUpDownIcon, Loader2Icon, Trash2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { IssueStatusBadge } from '@/components/status-badge';
import { DurationInput } from '@/components/duration-input';
import { TimePicker } from '@/components/time-picker';
import { api, ApiError, type IssueOption } from '@/api';
import { addMinutes, formatDay, formatDuration, fromISO, minutesBetween, timeRange, toISO } from '@/dates';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';
import type { WorklogEntry } from '../../../shared/types';

const PRESETS = {
  morning: { label: 'Morning', start: '09:00', end: '12:30' },
  afternoon: { label: 'Afternoon', start: '13:30', end: '18:00' },
} as const;
type PresetId = keyof typeof PRESETS;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Date to pre-fill (the clicked calendar day). */
  date: string;
  /** An existing work log to edit instead of logging new work. */
  entry?: WorklogEntry | null;
  onLogged: () => void;
}

export function LogWorkDialog({ open, onOpenChange, date: initialDate, entry: entryProp = null, onLogged }: Props) {
  // Keep showing the edited log while the dialog animates closed (the parent clears it on close).
  const lastEntry = useRef(entryProp);
  if (open) lastEntry.current = entryProp;
  const entry = open ? entryProp : lastEntry.current;
  const { creds, onUnauthorized } = useSession();
  // The task is kept between openings: logging several slots on the same task is common.
  const [issue, setIssue] = useState<IssueOption | null>(null);
  const [date, setDate] = useState(initialDate);
  // Start + duration are the source of truth; the end time is derived (and editable).
  const [start, setStart] = useState<string>(PRESETS.morning.start);
  const [minutes, setMinutes] = useState(minutesBetween(PRESETS.morning.start, PRESETS.morning.end));
  const { time: end, nextDay } = addMinutes(start, minutes);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (entry) {
      setIssue({
        key: entry.issueKey,
        summary: entry.summary,
        issueType: entry.issueType,
        status: entry.status,
        statusCategory: 'unknown',
        projectKey: entry.projectKey,
        projectName: entry.projectName,
      });
      setDate(entry.date);
      setStart(timeRange(entry.started, entry.timeSpentSeconds).from);
      setMinutes(Math.round(entry.timeSpentSeconds / 60));
      setComment(entry.comment);
    } else {
      setDate(initialDate);
      setComment('');
    }
  }, [open, initialDate, entry]);

  /** Minutes from `from` to `to`; an earlier `to` means the next day. */
  const spanTo = (from: string, to: string) => {
    const diff = minutesBetween(from, to);
    return diff > 0 ? diff : diff + 24 * 60;
  };
  const setEnd = (e: string) => setMinutes(spanTo(start, e));
  const setRange = (s: string, e: string) => {
    setStart(s);
    setMinutes(spanTo(s, e));
  };

  const preset = (Object.keys(PRESETS) as PresetId[]).find((p) => PRESETS[p].start === start && PRESETS[p].end === end) ?? '';
  const valid = Boolean(issue) && minutes > 0 && Boolean(date);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!issue || !valid) return;
    setSubmitting(true);
    setError('');
    try {
      const w = { issueKey: issue.key, date, start, seconds: minutes * 60, comment };
      const when = `${formatDay(date, { year: 'numeric' })}, ${start} – ${end}`;
      if (entry) {
        await api.updateWorklog(creds, entry, w);
        toast.success(
          issue.key === entry.issueKey ? `Updated work log on ${issue.key}` : `Moved work log from ${entry.issueKey} to ${issue.key}`,
          { description: `${formatDuration(minutes * 60)} · ${when}` },
        );
      } else {
        await api.addWorklog(creds, w);
        toast.success(`Logged ${formatDuration(minutes * 60)} on ${issue.key}`, { description: when });
      }
      onOpenChange(false);
      onLogged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!entry) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteWorklog(creds, entry.issueKey, entry.id);
      toast.success(`Deleted ${formatDuration(entry.timeSpentSeconds)} from ${entry.issueKey}`);
      onOpenChange(false);
      onLogged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid min-w-0 grid-cols-1 gap-5">
          <DialogHeader>
            <DialogTitle>{entry ? 'Edit work log' : 'Log work'}</DialogTitle>
            <DialogDescription>
              {entry
                ? 'Changes are saved to Jira. Picking another task moves the log there.'
                : 'Adds a work log to the selected Jira issue.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-w-0 grid-cols-1 gap-1.5">
            <Label>Task</Label>
            <IssuePicker value={issue} onChange={setIssue} />
          </div>

          <div className="grid gap-1.5">
            <Label>Date</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Time</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={preset}
                onValueChange={(v) => {
                  if (!v) return;
                  setRange(PRESETS[v as PresetId].start, PRESETS[v as PresetId].end);
                }}
              >
                {(Object.keys(PRESETS) as PresetId[]).map((p) => (
                  <ToggleGroupItem key={p} value={p} className="px-2.5">
                    {PRESETS[p].label}
                    <span className="text-xs font-normal opacity-70">{PRESETS[p].start}–{PRESETS[p].end}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">Start</span>
                <TimePicker value={start} onChange={setStart} onRange={setRange} aria-label="Start time" />
              </div>
              <span className="pb-1.5 text-muted-foreground">–</span>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  End{nextDay && <span className="ml-1 font-medium text-foreground">(next day)</span>}
                </span>
                <TimePicker value={end} onChange={setEnd} onRange={setRange} aria-label="End time" />
              </div>
              <div className="ml-auto grid gap-1">
                <label htmlFor="worklog-duration" className="text-xs text-muted-foreground">Time spent</label>
                <DurationInput id="worklog-duration" value={minutes} onChange={setMinutes} className="w-28 font-semibold" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Type the time spent like <b>3h 30m</b>, <b>2h</b> or <b>45m</b> (end time follows), or set start and end.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="worklog-comment">Description</Label>
            <Textarea
              id="worklog-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What did you work on?"
              rows={3}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            {entry && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive hover:text-destructive sm:mr-auto" disabled={deleting || submitting}>
                    {deleting ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this work log?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {formatDuration(entry.timeSpentSeconds)} on {entry.issueKey} ({formatDay(entry.date, { year: 'numeric' })}) will be
                      removed from Jira. This can’t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={remove}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || submitting || deleting}>
              {submitting && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              {entry ? 'Save changes' : `Log ${minutes > 0 ? formatDuration(minutes * 60) : 'work'}`}
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

/** Searchable issue picker: key, title or description (Jira full-text search). */
function IssuePicker({ value, onChange }: { value: IssueOption | null; onChange: (i: IssueOption) => void }) {
  const { creds } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 300);
  const { data, loading, error } = useAsync(
    (s) => (open ? api.searchIssueOptions(creds, q, s) : Promise.resolve(null)),
    [creds, q, open],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-auto min-h-9 w-full min-w-0 shrink justify-between overflow-hidden py-1.5 font-normal">
          {value ? (
            <span className="min-w-0 flex-1 truncate text-left" title={`${value.key} ${value.summary}`}>
              <span className="font-medium text-link">{value.key}</span> {value.summary}
            </span>
          ) : (
            <span className="text-muted-foreground">Search by key, title or description…</span>
          )}
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="PAY-12, checkout, refund…" />
          <CommandList>
            {loading && !data && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Searching Jira…
              </div>
            )}
            {error && <div className="p-3 text-sm text-destructive">{error.message}</div>}
            {data && <CommandEmpty>No issues found.</CommandEmpty>}
            {data && data.length > 0 && (
              <CommandGroup heading={q ? 'Results' : 'Your recent issues'}>
                {data.map((i) => (
                  <CommandItem
                    key={i.key}
                    value={i.key}
                    onSelect={() => {
                      onChange(i);
                      setOpen(false);
                    }}
                    className="items-start gap-2"
                  >
                    <CheckIcon className={cn('mt-0.5', value?.key === i.key ? 'opacity-100' : 'opacity-0')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        <span className="font-medium text-link">{i.key}</span> {i.summary}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {i.projectName} · {i.issueType}
                      </div>
                    </div>
                    <IssueStatusBadge status={i.status} category={i.statusCategory} />
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

function DatePicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start font-normal">
          <CalendarIcon data-icon="inline-start" />
          {formatDay(value, { year: 'numeric' })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={fromISO(value)}
          defaultMonth={fromISO(value)}
          onSelect={(d) => {
            if (d) onChange(toISO(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
