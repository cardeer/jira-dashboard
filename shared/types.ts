export interface Credentials {
  /** Normalised site origin, e.g. https://acme.atlassian.net */
  site: string;
  email: string;
  token: string;
}

export interface Me {
  accountId: string;
  displayName: string;
  email?: string;
}

export type StatusCategory = 'new' | 'indeterminate' | 'done' | 'unknown';

export interface Task {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  priority: string | null;
  issueType: string;
  projectKey: string;
  projectName: string;
  updated: string;
  dueDate: string | null;
}

export interface WorklogEntry {
  id: string;
  issueKey: string;
  summary: string;
  issueType: string;
  status: string;
  projectKey: string;
  projectName: string;
  /** Raw `started` value from Jira (ISO with offset). */
  started: string;
  /** Calendar date of `started`, YYYY-MM-DD. */
  date: string;
  timeSpentSeconds: number;
  comment: string;
}

export type TaskFilter = 'open' | 'done' | 'all';
