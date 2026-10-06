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

export const formatDate = (iso: string) =>
  fromISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Whole days from today to `iso` (negative when in the past). */
export function daysFromToday(iso: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((fromISO(iso).getTime() - today.getTime()) / 86400000);
}

export function describeDays(n: number): string {
  if (n === 0) return 'today';
  const abs = Math.abs(n);
  const unit = `${abs} day${abs === 1 ? '' : 's'}`;
  return n > 0 ? `in ${unit}` : `${unit} ago`;
}

/**
 * "09:00 – 10:30" for a worklog. Uses the wall-clock time in Jira's `started` string
 * (e.g. 2026-10-05T09:00:00.000+0700) so it matches what Jira shows, regardless of browser timezone.
 */
export function timeRange(started: string, seconds: number): { from: string; to: string; nextDay: boolean } {
  const m = /T(\d{2}):(\d{2})/.exec(started);
  const startMin = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const endMin = startMin + Math.round(seconds / 60);
  const fmt = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  return { from: fmt(startMin), to: fmt(endMin), nextDay: endMin >= 24 * 60 };
}

/** The Monday-to-Sunday weeks covering a month (YYYY-MM), for a calendar grid. */
export function monthGrid(month: string): { from: string; to: string; days: string[] } {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(last);
  end.setDate(last.getDate() + ((7 - last.getDay()) % 7));
  const from = toISO(start);
  const to = toISO(end);
  return { from, to, days: eachDay(from, to) };
}

/** Minutes between two HH:MM times (negative if end is before start). */
export const minutesBetween = (start: string, end: string) => {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  return toMin(end) - toMin(start);
};

const HOURS_PER_DAY = 8;

/**
 * Jira-style duration → minutes, or null. Accepts "3h 30m", "3h30m", "2h", "45m", "1.5h",
 * "1d" (= 8h, Jira's default working day), "3:30", and a bare number meaning hours ("2", "1.5").
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (clock) {
    const m = Number(clock[2]);
    return m < 60 ? Number(clock[1]) * 60 + m : null;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60) || null;
  const re = /(\d+(?:\.\d+)?)\s*(d|h|m)/g;
  let total = 0;
  let consumed = '';
  for (const match of s.matchAll(re)) {
    const n = Number(match[1]);
    total += match[2] === 'd' ? n * HOURS_PER_DAY * 60 : match[2] === 'h' ? n * 60 : n;
    consumed += match[0];
  }
  // Reject leftovers like "3x" or "abc".
  if (!consumed || consumed.replace(/\s/g, '') !== s.replace(/\s/g, '')) return null;
  return Math.round(total) || null;
}

/** "09:00" + 210 → { time: "12:30", nextDay: false } */
export function addMinutes(time: string, minutes: number): { time: string; nextDay: boolean } {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { time: `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`, nextDay: total >= 1440 };
}
