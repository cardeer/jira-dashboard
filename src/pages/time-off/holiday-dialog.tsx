import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toISO } from '@/dates';
import { sheets } from '@/sheets';
import { DateRangePicker } from '../worklogs/date-range-picker';
import { EntryDialog } from './entry-dialog';
import type { Holiday } from '../../../shared/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null adds a new holiday. */
  holiday: Holiday | null;
  onSaved: () => void;
}

export function HolidayDialog({ open, onOpenChange, holiday, onSaved }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    const today = toISO(new Date());
    setFrom(holiday?.start_date ?? today);
    setTo(holiday?.end_date ?? today);
    setName(holiday?.name ?? '');
    setNote(holiday?.note ?? '');
  }, [open, holiday]);

  return (
    <EntryDialog
      open={open}
      onOpenChange={onOpenChange}
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      description="A day (or days) off for everyone."
      valid={Boolean(name.trim() && from && to)}
      onSave={async () => {
        await sheets.saveHoliday({ id: holiday?.id, start_date: from, end_date: to, name: name.trim(), note: note.trim() });
        toast.success(holiday ? `Updated ${name.trim()}` : `Added ${name.trim()}`);
        onSaved();
      }}
      onDelete={
        holiday
          ? {
              what: holiday.name,
              run: async () => {
                await sheets.remove('Holidays', holiday.id);
                toast.success(`Deleted ${holiday.name}`);
                onSaved();
              },
            }
          : undefined
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="holiday-name">Name</Label>
        <Input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Songkran" autoFocus />
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
        <p className="text-xs text-muted-foreground">Click the same day twice for a single day.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="holiday-note">Note</Label>
        <Textarea id="holiday-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
    </EntryDialog>
  );
}
