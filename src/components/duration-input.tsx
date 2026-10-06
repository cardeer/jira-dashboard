import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatDuration, parseDuration } from '@/dates';
import { cn } from '@/lib/utils';

interface Props {
  /** Minutes */
  value: number;
  onChange: (minutes: number) => void;
  className?: string;
  id?: string;
}

/** Jira-style "time spent" field: type 3h 30m, 2h, 45m, 1.5h, 1d or 3:30. */
export function DurationInput({ value, onChange, className, id }: Props) {
  const shown = value > 0 ? formatDuration(value * 60) : '';
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const valid = !draft.trim() || parseDuration(draft) !== null;

  function commit() {
    const minutes = parseDuration(draft);
    if (minutes) onChange(minutes);
    setDraft(minutes ? formatDuration(minutes * 60) : shown);
  }

  return (
    <Input
      id={id}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(shown);
        }
      }}
      onFocus={(e) => e.currentTarget.select()}
      placeholder="3h 30m"
      aria-invalid={!valid}
      className={cn('tabular-nums', className)}
    />
  );
}
