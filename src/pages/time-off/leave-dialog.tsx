import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TimePicker } from '@/components/time-picker';
import { UserPicker } from '@/components/user-picker';
import { minutesBetween, toISO } from '@/dates';
import { useSession } from '@/lib/session';
import { sheets } from '@/sheets';
import { DateRangePicker } from '../worklogs/date-range-picker';
import { PRESETS, type PresetId } from '../worklogs/log-work-dialog';
import { EntryDialog } from './entry-dialog';
import type { Leave, Person } from '../../../shared/types';

export const LEAVE_TYPES = [
  { id: 'vacation', label: 'Vacation leave' },
  { id: 'sick', label: 'Sick leave' },
  { id: 'personal', label: 'Personal leave' },
  { id: 'birthday', label: 'Birthday leave' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null adds a new leave for the signed-in user. */
  leave: Leave | null;
  onSaved: () => void;
}

export function LeaveDialog({ open, onOpenChange, leave, onSaved }: Props) {
  const { me } = useSession();
  const [person, setPerson] = useState<Person>(me);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [partial, setPartial] = useState(false);
  const [start, setStart] = useState<string>(PRESETS.morning.start);
  const [end, setEnd] = useState<string>(PRESETS.morning.end);
  const [type, setType] = useState('vacation');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    const today = toISO(new Date());
    // Only the id and name are stored; the picker shows the name until someone else is picked.
    setPerson(leave ? { accountId: leave.account_id, displayName: leave.name } : me);
    setFrom(leave?.start_date ?? today);
    setTo(leave?.end_date ?? today);
    setPartial(Boolean(leave?.start_time));
    setStart(leave?.start_time || PRESETS.morning.start);
    setEnd(leave?.end_time || PRESETS.morning.end);
    setType(leave?.type || 'vacation');
    setNote(leave?.note ?? '');
  }, [open, leave, me]);

  const timesValid = !partial || minutesBetween(start, end) > 0;
  const preset = (Object.keys(PRESETS) as PresetId[]).find((p) => PRESETS[p].start === start && PRESETS[p].end === end) ?? '';
  const isMe = person.accountId === me.accountId;

  return (
    <EntryDialog
      open={open}
      onOpenChange={onOpenChange}
      title={leave ? 'Edit leave' : 'Add leave'}
      description="Whole days, or part of each day between two times."
      valid={Boolean(from && to && timesValid)}
      onSave={async () => {
        await sheets.saveLeave({
          id: leave?.id,
          account_id: person.accountId,
          name: person.displayName,
          start_date: from,
          end_date: to,
          start_time: partial ? start : '',
          end_time: partial ? end : '',
          type,
          note: note.trim(),
        });
        toast.success(leave ? 'Updated leave' : `Added leave for ${isMe ? 'you' : person.displayName}`);
        onSaved();
      }}
      onDelete={
        leave
          ? {
              what: `${leave.name}’s leave`,
              run: async () => {
                await sheets.remove('Leaves', leave.id);
                toast.success('Deleted leave');
                onSaved();
              },
            }
          : undefined
      }
    >
      <div className="grid gap-1.5">
        <Label>Person</Label>
        <div>
          <UserPicker value={isMe ? null : person} onChange={(p) => p !== 'all' && setPerson(p ?? me)} allowAll={false} meLabel={me.displayName} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Dates</Label>
        {from && (
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) => {
              setFrom(f);
              setTo(t);
            }}
          />
        )}
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Time</Label>
          <ToggleGroup type="single" variant="outline" size="sm" value={partial ? 'partial' : 'full'} onValueChange={(v) => v && setPartial(v === 'partial')}>
            <ToggleGroupItem value="full">Full day</ToggleGroupItem>
            <ToggleGroupItem value="partial">Part of day</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {partial && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="justify-start"
            value={preset}
            onValueChange={(v) => {
              if (!v) return;
              setStart(PRESETS[v as PresetId].start);
              setEnd(PRESETS[v as PresetId].end);
            }}
          >
            {(Object.keys(PRESETS) as PresetId[]).map((p) => (
              <ToggleGroupItem key={p} value={p} className="px-2.5">
                {PRESETS[p].label}
                <span className="text-xs font-normal opacity-70">{PRESETS[p].start}–{PRESETS[p].end}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {partial && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">From</span>
              <TimePicker value={start} onChange={setStart} onRange={(s, e) => (setStart(s), setEnd(e))} aria-label="Start time" />
            </div>
            <span className="pb-1.5 text-muted-foreground">–</span>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">To</span>
              <TimePicker value={end} onChange={setEnd} onRange={(s, e) => (setStart(s), setEnd(e))} aria-label="End time" />
            </div>
          </div>
        )}
        {!timesValid && <p className="text-xs text-destructive">The end time must be after the start time.</p>}
      </div>
      <div className="grid gap-1.5">
        <Label>Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAVE_TYPES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="leave-note">Note</Label>
        <Textarea id="leave-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
    </EntryDialog>
  );
}
