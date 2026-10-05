const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export type Preset = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'last-30';

export const PRESETS: { id: Preset; label: string }[] = [
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-30', label: 'Last 30 days' },
];

/** Weeks start on Monday. */
export function presetRange(p: Preset, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  switch (p) {
    case 'this-week': {
      const sun = new Date(monday);
      sun.setDate(monday.getDate() + 6);
      return { from: toISO(monday), to: toISO(sun) };
    }
    case 'last-week': {
      const mon = new Date(monday);
      mon.setDate(monday.getDate() - 7);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { from: toISO(mon), to: toISO(sun) };
    }
    case 'this-month':
      return {
        from: toISO(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: toISO(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    case 'last-month':
      return {
        from: toISO(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: toISO(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case 'last-30': {
      const start = new Date(today);
      start.setDate(today.getDate() - 29);
      return { from: toISO(start), to: toISO(today) };
    }
  }
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = fromISO(from);
  const end = fromISO(to);
  while (d <= end && out.length < 400) {
    out.push(toISO(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export const formatDay = (iso: string, opts: Intl.DateTimeFormatOptions = {}) =>
  fromISO(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...opts });

export const isWeekend = (iso: string) => [0, 6].includes(fromISO(iso).getDay());

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export const formatHours = (seconds: number) => (seconds / 3600).toFixed(1);

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
