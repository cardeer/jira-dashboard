import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ClockIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Lenient time parsing → "HH:MM", or null.
 * Accepts 9, 09, 930, 0930, 9:30, 9.30, 9h30, 13H05.
 */
export function parseTime(input: string): string | null {
  const s = input.trim();
  let h: number;
  let m = 0;
  const sep = /^(\d{1,2})\s*[:.hH]\s*(\d{1,2})$/.exec(s);
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2]);
  } else if (/^\d{1,4}$/.test(s)) {
    // 1–2 digits: hour only; 3–4 digits: last two are minutes (930 → 9:30, 1345 → 13:45).
    if (s.length <= 2) h = Number(s);
    else {
      h = Number(s.slice(0, -2));
      m = Number(s.slice(-2));
    }
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** "9-12:30", "09:00 – 12:30", "13:30 to 18" → [start, end], or null. */
export function parseTimeRange(input: string): [string, string] | null {
  const parts = input.split(/\s*(?:-|–|—|to)\s*/i);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(parseTime);
  return a && b ? [a, b] : null;
}

interface Props {
  /** HH:MM (24h) */
  value: string;
  onChange: (value: string) => void;
  /** Called instead of onChange when a range like "9:00-12:30" is typed. */
  onRange?: (start: string, end: string) => void;
  /** Minute step for the minute column (default 5). An off-step current value is still listed. */
  step?: number;
  className?: string;
  'aria-label'?: string;
}

/** Typeable time field (HH:MM) with an hour/minute picker popover, built from shadcn primitives. */
export function TimePicker({ value, onChange, onRange, step = 5, className, 'aria-label': ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [h, m] = value.split(':').map(Number);

  // Follow outside changes (presets, the popover, the other field's range input).
  useEffect(() => setDraft(value), [value]);

  const draftValid = !draft.trim() || parseTime(draft) !== null || (onRange && parseTimeRange(draft) !== null);

  function commit() {
    const range = onRange ? parseTimeRange(draft) : null;
    if (range) {
      onRange!(range[0], range[1]);
      return;
    }
    const t = parseTime(draft);
    if (t) {
      onChange(t);
      setDraft(t);
    } else {
      setDraft(value); // unparseable: put the last good value back
    }
  }

  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (!minutes.includes(m)) minutes.push(m);
  minutes.sort((a, b) => a - b);

  const hourRef = useRef<HTMLButtonElement>(null);
  const minuteRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      hourRef.current?.scrollIntoView({ block: 'center' });
      minuteRef.current?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <InputGroup className={cn('w-32', className)}>
          <InputGroupInput
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); // don't submit the form with a half-typed value
                commit();
              } else if (e.key === 'Escape') {
                setDraft(value);
              } else if (e.key === 'ArrowDown' && e.altKey) {
                setOpen(true);
              }
            }}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="HH:MM"
            inputMode="numeric"
            aria-label={ariaLabel}
            aria-invalid={!draftValid}
            className="tabular-nums"
          />
          <InputGroupAddon align="inline-end">
            <PopoverTrigger asChild>
              <InputGroupButton size="icon-xs" aria-label={`Pick ${ariaLabel?.toLowerCase() ?? 'time'}`}>
                <ClockIcon />
              </InputGroupButton>
            </PopoverTrigger>
          </InputGroupAddon>
        </InputGroup>
      </PopoverAnchor>
      <PopoverContent className="w-auto p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="grid grid-cols-2 divide-x border-b text-center text-xs font-medium text-muted-foreground">
          <span className="py-1.5">Hour</span>
          <span className="py-1.5">Min</span>
        </div>
        <div className="flex divide-x">
          <Column>
            {HOURS.map((hour) => (
              <Button
                key={hour}
                ref={hour === h ? hourRef : undefined}
                type="button"
                size="sm"
                variant={hour === h ? 'default' : 'ghost'}
                className="w-full tabular-nums"
                aria-pressed={hour === h}
                onClick={() => onChange(`${pad(hour)}:${pad(m)}`)}
              >
                {pad(hour)}
              </Button>
            ))}
          </Column>
          <Column>
            {minutes.map((minute) => (
              <Button
                key={minute}
                ref={minute === m ? minuteRef : undefined}
                type="button"
                size="sm"
                variant={minute === m ? 'default' : 'ghost'}
                className="w-full tabular-nums"
                aria-pressed={minute === m}
                onClick={() => {
                  onChange(`${pad(h)}:${pad(minute)}`);
                  setOpen(false);
                }}
              >
                {pad(minute)}
              </Button>
            ))}
          </Column>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Column({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="h-56 w-16">
      <div className="grid gap-0.5 p-1">{children}</div>
    </ScrollArea>
  );
}
