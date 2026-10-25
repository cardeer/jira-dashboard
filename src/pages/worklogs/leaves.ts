import { eachDay, isWeekend, minutesBetween } from '@/dates';
import type { Holiday, Leave } from '../../../shared/types';
import { LEAVE_TYPES } from '../time-off/leave-dialog';

const FULL_DAY_SECONDS = 8 * 3600;

/** One leave on one day: a full day counts as 8h, part of a day as its start–end time. */
export interface LeaveDay {
  leave: Leave;
  seconds: number;
}

export const leaveLabel = (l: Leave) => LEAVE_TYPES.find((t) => t.id === l.type)?.label ?? (l.type || 'Leave');

export const leaveTime = (l: Leave) => (l.start_time && l.end_time ? `${l.start_time} – ${l.end_time}` : 'Full day');

/** The days of a date range that fall between from and to. */
const daysWithin = (start: string, end: string, from: string, to: string) =>
  end < from || start > to ? [] : eachDay(start < from ? from : start, end > to ? to : end);

/** Holidays between from and to, keyed by YYYY-MM-DD. */
export function holidayDays(holidays: Holiday[], from: string, to: string): Map<string, Holiday[]> {
  const out = new Map<string, Holiday[]>();
  for (const h of holidays) {
    for (const d of daysWithin(h.start_date, h.end_date, from, to)) out.set(d, [...(out.get(d) ?? []), h]);
  }
  return out;
}

/** Leaves spread over the working days (not weekends or holidays) they cover between from and to. */
export function leaveDays(leaves: Leave[], from: string, to: string, holidays?: Map<string, Holiday[]>): Map<string, LeaveDay[]> {
  const out = new Map<string, LeaveDay[]>();
  for (const l of leaves) {
    const seconds = l.start_time && l.end_time ? Math.max(0, minutesBetween(l.start_time, l.end_time)) * 60 : FULL_DAY_SECONDS;
    for (const d of daysWithin(l.start_date, l.end_date, from, to)) {
      if (isWeekend(d) || holidays?.has(d)) continue;
      out.set(d, [...(out.get(d) ?? []), { leave: l, seconds }]);
    }
  }
  return out;
}
