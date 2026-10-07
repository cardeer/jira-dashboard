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
  avatarUrl?: string;
}

/** A Jira user whose work logs can be viewed. */
export type Person = Me;

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

export interface Release {
  id: string;
  name: string;
  description: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  released: boolean;
  archived: boolean;
  /** Not released and the release date has passed. */
  overdue: boolean;
  startDate: string | null;
  releaseDate: string | null;
}

export interface ReleaseIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  issueType: string;
  priority: string | null;
  assignee: string | null;
}

export type ReleaseFilter = 'unreleased' | 'released' | 'all';
