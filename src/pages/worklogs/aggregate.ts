import type { WorklogEntry } from '../../../shared/types';
import { eachDay } from '@/dates';

export const DAY_TARGET = 8 * 3600;

export interface TaskGroup {
  key: string;
  summary: string;
  projectKey: string;
  projectName: string;
  status: string;
  seconds: number;
  entries: WorklogEntry[];
}

export function summarize(entries: WorklogEntry[], from: string, to: string) {
  const perDay = new Map<string, number>(eachDay(from, to).map((d) => [d, 0]));
  const tasks = new Map<string, TaskGroup>();
  const projects = new Map<string, { key: string; name: string; seconds: number }>();
  let total = 0;

  for (const e of entries) {
    total += e.timeSpentSeconds;
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.timeSpentSeconds);
    const t = tasks.get(e.issueKey) ?? {
      key: e.issueKey,
      summary: e.summary,
      projectKey: e.projectKey,
      projectName: e.projectName,
      status: e.status,
      seconds: 0,
      entries: [],
    };
    t.seconds += e.timeSpentSeconds;
    t.entries.push(e);
    tasks.set(e.issueKey, t);
    const p = projects.get(e.projectKey) ?? { key: e.projectKey, name: e.projectName, seconds: 0 };
    p.seconds += e.timeSpentSeconds;
    projects.set(e.projectKey, p);
  }

  return {
    total,
    days: perDay.size,
    daysLogged: [...perDay.values()].filter((s) => s > 0).length,
    perDay: [...perDay.entries()],
    byTask: [...tasks.values()].sort((a, b) => b.seconds - a.seconds),
    byProject: [...projects.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

export type Summary = ReturnType<typeof summarize>;

/** 6.75, 3.5, 8 — hours with up to two decimals, like Jira's timesheet reports. */
export const hours = (seconds: number) => String(Math.round((seconds / 3600) * 100) / 100);
