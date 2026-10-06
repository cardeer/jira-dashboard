import { useRef, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fromISO, toISO } from '@/dates';

const label = (iso: string, withYear: boolean) =>
  fromISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });

export function DateRangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const clicks = useRef(0);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        clicks.current = 0;
        setDraft(o ? { from: fromISO(from), to: fromISO(to) } : undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-start font-normal tabular-nums">
          <CalendarIcon data-icon="inline-start" />
          {label(from, !sameYear)} – {label(to, true)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          weekStartsOn={1}
          defaultMonth={fromISO(from)}
          selected={draft}
          onSelect={(r, day) => {
            clicks.current += 1;
            // First click starts a new range; the second click (even on the same day) applies it.
            const next = clicks.current === 1 ? { from: day, to: undefined } : r;
            setDraft(next);
            if (clicks.current >= 2) {
              const a = next?.from ?? day;
              const b = next?.to ?? day;
              const [start, end] = a <= b ? [a, b] : [b, a];
              onChange(toISO(start), toISO(end));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
