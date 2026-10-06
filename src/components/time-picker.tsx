import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ClockIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface Props {
  /** HH:MM (24h) */
  value: string;
  onChange: (value: string) => void;
  /** Minute step for the minute column (default 5). An off-step current value is still listed. */
  step?: number;
  className?: string;
  'aria-label'?: string;
}

/** Time picker built from shadcn primitives: hour and minute columns in a popover. */
export function TimePicker({ value, onChange, step = 5, className, 'aria-label': ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [h, m] = value.split(':').map(Number);
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (!minutes.includes(m)) minutes.push(m);
  minutes.sort((a, b) => a - b);

  const hourRef = useRef<HTMLButtonElement>(null);
  const minuteRef = useRef<HTMLButtonElement>(null);

  // Bring the current value into view when the popover opens.
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
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-start font-normal tabular-nums', className)} aria-label={ariaLabel}>
          <ClockIcon data-icon="inline-start" className="text-muted-foreground" />
          {pad(h)}:{pad(m)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
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
