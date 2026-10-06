import axios from 'axios';
import type {
  Credentials,
  Me,
  Release,
  ReleaseIssue,
  StatusCategory,
  Task,
  TaskFilter,
  WorklogEntry,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Flattens Atlassian Document Format to plain text. */
function adfToText(node: AdfNode | string | null | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  if (node.type === 'hardBreak') return '\n';
  const blockContainer = ['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote'];
  return (node.content ?? []).map(adfToText).join(blockContainer.includes(node.type ?? '') ? '\n' : '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** UTF-8 safe Basic auth header (btoa alone breaks on non-Latin1 characters). */
function basicAuth(email: string, token: string) {
  const bytes = new TextEncoder().encode(`${email}:${token}`);
  return 'Basic ' + btoa(String.fromCharCode(...bytes));
}

/**
 * Same-origin path that the host rewrites to https://<site>.atlassian.net (see vercel.json and
 * vite.config.ts). Calling Jira cross-origin from a browser is blocked by CORS.
 */
const jiraBase = (c: Credentials) => `/api/jira/${new URL(c.site).hostname.split('.')[0]}/rest/api/3`;

/** Talks to Jira Cloud through the same-origin rewrite, using axios. */
async function jiraRequest<T>(
  c: Credentials,
  method: 'GET' | 'POST',
  path: string,
  opts: { params?: Record<string, string | number>; data?: unknown } = {},
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await axios.request({
        method,
        url: `${jiraBase(c)}${path}`,
        params: opts.params,
        data: opts.data,
        signal,
        headers: {
          Authorization: basicAuth(c.email, c.token),
          Accept: 'application/json',
          // Writes from a browser-originated request are otherwise rejected with "XSRF check failed".
          ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' } : {}),
        },
        validateStatus: () => true,
        timeout: 30_000,
      });
    } catch (e) {
      if (axios.isCancel(e)) throw new DOMException('Aborted', 'AbortError');
      throw new ApiError(0, 'Could not reach Jira (network error, or the /api/jira rewrite is not set up on this host).');
    }
    // Only GETs are safe to retry automatically.
    if (res.status === 429 && method === 'GET' && attempt < 3) {
      await sleep((Number(res.headers['retry-after']) || 2 ** attempt) * 1000);
      continue;
    }
    if (res.status === 401) throw new ApiError(401, 'Jira rejected the email / API token');
    if (res.status >= 400) {
      const body = res.data as { errorMessages?: string[]; errors?: Record<string, string> } | string | undefined;
      const messages =
        typeof body === 'object' && body
          ? [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})]
          : [];
      const detail = messages.length
        ? messages.join('; ')
        : res.status === 403
          ? 'Jira denied access to this resource'
          : String(typeof body === 'string' ? body : JSON.stringify(body ?? '')).slice(0, 300);
      if (res.status === 403 && /XSRF check failed/i.test(String(res.data))) {
        throw new ApiError(
          403,
          'Jira rejected the write (XSRF check failed): the /api/jira proxy must send a non-browser User-Agent. ' +
            'Redeploy with the current vercel.json.',
        );
      }
      throw new ApiError(res.status, res.status === 403 ? detail : `Jira error ${res.status}: ${detail}`);
    }
    return res.data as T;
  }
}

const jiraGet = <T,>(c: Credentials, path: string, params: Record<string, string | number> = {}, signal?: AbortSignal) =>
  jiraRequest<T>(c, 'GET', path, { params }, signal);

async function searchIssues<F>(c: Credentials, jql: string, fields: string[], signal?: AbortSignal, cap = 1000) {
  interface Page {
    issues: { key: string; fields: F }[];
    nextPageToken?: string;
    isLast?: boolean;
  }
  const out: Page['issues'] = [];
  let nextPageToken: string | undefined;
  do {
    const page: Page = await jiraGet<Page>(
      c,
      '/search/jql',
      { jql, fields: fields.join(','), maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) },
      signal,
    );
    out.push(...page.issues);
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken && out.length < cap);
  return out;
}

async function me(c: Credentials, signal?: AbortSignal): Promise<Me> {
  const u = await jiraGet<{ accountId: string; displayName: string; emailAddress?: string }>(c, '/myself', {}, signal);
  return { accountId: u.accountId, displayName: u.displayName, email: u.emailAddress };
}

async function tasks(c: Credentials, filter: TaskFilter, signal?: AbortSignal): Promise<Task[]> {
  const clause = {
    open: 'statusCategory != Done',
    done: 'statusCategory = Done AND updated >= -30d',
    all: '(statusCategory != Done OR updated >= -30d)',
  }[filter];

  interface F {
    summary: string;
    status: { name: string; statusCategory?: { key: string } };
    priority?: { name: string } | null;
    issuetype: { name: string };
    project: { key: string; name: string };
    updated: string;
    duedate: string | null;
  }
  const issues = await searchIssues<F>(
    c,
    `assignee = currentUser() AND ${clause} ORDER BY updated DESC`,
    ['summary', 'status', 'priority', 'issuetype', 'project', 'updated', 'duedate'],
    signal,
  );
  return issues.map((i) => {
    const cat = i.fields.status.statusCategory?.key;
    const statusCategory: StatusCategory = cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown';
    return {
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status.name,
      statusCategory,
      priority: i.fields.priority?.name ?? null,
      issueType: i.fields.issuetype.name,
      projectKey: i.fields.project.key,
      projectName: i.fields.project.name,
      updated: i.fields.updated,
      dueDate: i.fields.duedate,
    };
  });
}

/** All of the current user's worklogs between two dates (inclusive), across every project. */
async function worklogs(c: Credentials, from: string, to: string, signal?: AbortSignal): Promise<WorklogEntry[]> {
  const mine = await me(c, signal);

  // Pad the JQL window by a day each side: worklogDate is evaluated in the viewer's timezone
  // while `started` carries its own offset. We filter precisely below.
  const pad = (d: string, days: number) => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  };
  interface F {
    summary: string;
    status: { name: string };
    issuetype: { name: string };
    project: { key: string; name: string };
  }
  const issues = await searchIssues<F>(
    c,
    `worklogAuthor = currentUser() AND worklogDate >= "${pad(from, -1)}" AND worklogDate <= "${pad(to, 1)}"`,
    ['summary', 'status', 'issuetype', 'project'],
    signal,
    500,
  );

  interface RawWorklog {
    id: string;
    author?: { accountId: string };
    started: string;
    timeSpentSeconds: number;
    comment?: AdfNode | string;
  }
  const fetchIssueWorklogs = async (issue: (typeof issues)[number]) => {
    const out: WorklogEntry[] = [];
    let startAt = 0;
    for (;;) {
      const page = await jiraGet<{ worklogs: RawWorklog[]; total: number }>(
        c,
        `/issue/${issue.key}/worklog`,
        { startAt, maxResults: 1000 },
        signal,
      );
      for (const w of page.worklogs) {
        if (w.author?.accountId !== mine.accountId) continue;
        const date = w.started.slice(0, 10);
        if (date < from || date > to) continue;
        out.push({
          id: w.id,
          issueKey: issue.key,
          summary: issue.fields.summary,
          issueType: issue.fields.issuetype.name,
          status: issue.fields.status.name,
          projectKey: issue.fields.project.key,
          projectName: issue.fields.project.name,
          started: w.started,
          date,
          timeSpentSeconds: w.timeSpentSeconds,
          comment: adfToText(w.comment).trim(),
        });
      }
      startAt += page.worklogs.length;
      if (page.worklogs.length === 0 || startAt >= page.total) break;
    }
    return out;
  };

  // Small worker pool so we stay well under Jira's rate limits.
  const results: WorklogEntry[][] = new Array(issues.length);
  let next = 0;
  const worker = async () => {
    while (next < issues.length) {
      signal?.throwIfAborted();
      const idx = next++;
      results[idx] = await fetchIssueWorklogs(issues[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, issues.length) }, worker));

  return results.flat().sort((a, b) => (a.started < b.started ? 1 : -1));
}

export interface ProjectRef {
  id: string;
  key: string;
  name: string;
}

/** Projects the user can browse (for the release project picker). */
async function projects(c: Credentials, signal?: AbortSignal): Promise<ProjectRef[]> {
  const out: ProjectRef[] = [];
  for (let startAt = 0; ; ) {
    const page = await jiraGet<{ values: ProjectRef[]; isLast?: boolean; total?: number }>(
      c,
      '/project/search',
      { startAt, maxResults: 50, orderBy: 'name' },
      signal,
    );
    out.push(...page.values);
    startAt += page.values.length;
    if (page.isLast || page.values.length === 0 || startAt >= (page.total ?? Infinity)) break;
  }
  return out;
}

export type ReleaseStatus = 'unreleased' | 'released' | 'all';
export type ReleaseOrder = 'releaseDate' | '-releaseDate' | 'startDate' | '-startDate' | 'name';

export interface ReleasePageQuery {
  project: ProjectRef;
  status: ReleaseStatus;
  /** Case-insensitive match on name/description, done by Jira. */
  query: string;
  orderBy: ReleaseOrder;
  page: number;
  pageSize: number;
}

export interface ReleasePage {
  releases: Release[];
  /** Total versions matching the filters (not just this page). */
  total: number;
}

/** One page of a project's release versions; paging, filtering and sorting happen in Jira. */
async function releasePage(c: Credentials, q: ReleasePageQuery, signal?: AbortSignal): Promise<ReleasePage> {
  interface RawVersion {
    id: string;
    name: string;
    description?: string;
    archived?: boolean;
    released?: boolean;
    startDate?: string;
    releaseDate?: string;
  }
  const params: Record<string, string | number> = {
    startAt: (q.page - 1) * q.pageSize,
    maxResults: q.pageSize,
    orderBy: q.orderBy,
  };
  if (q.query.trim()) params.query = q.query.trim();
  if (q.status !== 'all') params.status = q.status;

  const res = await jiraGet<{ values: RawVersion[]; total: number }>(
    c,
    `/project/${encodeURIComponent(q.project.key)}/version`,
    params,
    signal,
  );
  const today = new Date().toISOString().slice(0, 10);
  const releases = res.values.map((v): Release => {
    const released = Boolean(v.released);
    return {
      id: v.id,
      name: v.name,
      description: v.description ?? '',
      projectId: q.project.id,
      projectKey: q.project.key,
      projectName: q.project.name,
      released,
      archived: Boolean(v.archived),
      overdue: !released && Boolean(v.releaseDate) && v.releaseDate! < today,
      startDate: v.startDate ?? null,
      releaseDate: v.releaseDate ?? null,
    };
  });
  return { releases, total: res.total };
}

/** A single release by id (used when a release detail URL is opened directly). */
async function release(c: Credentials, versionId: string, signal?: AbortSignal): Promise<Release> {
  const v = await jiraGet<{
    id: string;
    name: string;
    description?: string;
    archived?: boolean;
    released?: boolean;
    startDate?: string;
    releaseDate?: string;
    projectId: number | string;
  }>(c, `/version/${encodeURIComponent(versionId)}`, {}, signal);
  const p = await jiraGet<ProjectRef>(c, `/project/${v.projectId}`, {}, signal);
  const released = Boolean(v.released);
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: v.id,
    name: v.name,
    description: v.description ?? '',
    projectId: String(p.id),
    projectKey: p.key,
    projectName: p.name,
    released,
    archived: Boolean(v.archived),
    overdue: !released && Boolean(v.releaseDate) && v.releaseDate! < today,
    startDate: v.startDate ?? null,
    releaseDate: v.releaseDate ?? null,
  };
}

/** Issues whose Fix Version is the given release. */
async function releaseIssues(c: Credentials, versionId: string, signal?: AbortSignal): Promise<ReleaseIssue[]> {
  interface F {
    summary: string;
    status: { name: string; statusCategory?: { key: string } };
    issuetype: { name: string };
    priority?: { name: string } | null;
    assignee?: { displayName: string } | null;
  }
  const issues = await searchIssues<F>(
    c,
    `fixVersion = ${Number(versionId)} ORDER BY status ASC, key ASC`,
    ['summary', 'status', 'issuetype', 'priority', 'assignee'],
    signal,
  );
  return issues.map((i) => {
    const cat = i.fields.status.statusCategory?.key;
    return {
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status.name,
      statusCategory: cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown',
      issueType: i.fields.issuetype.name,
      priority: i.fields.priority?.name ?? null,
      assignee: i.fields.assignee?.displayName ?? null,
    };
  });
}

export interface IssueOption {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  statusCategory: StatusCategory;
  projectKey: string;
  projectName: string;
}

interface PickerFields {
  summary: string;
  status: { name: string; statusCategory?: { key: string } };
  issuetype: { name: string };
  project: { key: string; name: string };
}
type PickerIssue = { key: string; fields: PickerFields };
const PICKER_FIELDS = ['summary', 'status', 'issuetype', 'project'];
const RECENT_JQL = '(assignee = currentUser() OR worklogAuthor = currentUser()) AND updated >= -60d ORDER BY updated DESC';

/** "1234" → number only; "NCS-1234" / "ncs1234" → project + number. */
const KEY_QUERY_RE = /^(?:([A-Za-z][A-Za-z0-9_]*?)-?)?(\d+)$/;
/** Jira's bulk fetch accepts at most 100 keys. */
const BULK_LIMIT = 100;
/** How many candidate keys to try one by one if bulk fetch is unavailable. */
const GET_FALLBACK_LIMIT = 12;

/**
 * Project keys to try for a bare issue number, your recently used projects first.
 * Cached per account for the session (not tied to one request's AbortSignal).
 */
const projectKeyCache = new Map<string, Promise<string[]>>();
function projectKeysFor(c: Credentials): Promise<string[]> {
  const id = `${c.site}|${c.email}`;
  let p = projectKeyCache.get(id);
  if (!p) {
    p = (async () => {
      const [recent, all] = await Promise.all([
        jiraGet<{ issues: PickerIssue[] }>(c, '/search/jql', { jql: RECENT_JQL, fields: 'project', maxResults: 100 }),
        projects(c),
      ]);
      return [...new Set([...recent.issues.map((i) => i.fields.project.key), ...all.map((x) => x.key)])];
    })();
    p.catch(() => projectKeyCache.delete(id));
    projectKeyCache.set(id, p);
  }
  return p;
}

/** Fetch issues by key; keys that don't exist are simply skipped (unlike `key in (...)` in JQL). */
async function fetchByKeys(c: Credentials, keys: string[], signal?: AbortSignal): Promise<PickerIssue[]> {
  if (keys.length === 0) return [];
  try {
    const res = await jiraRequest<{ issues?: PickerIssue[] }>(
      c,
      'POST',
      '/issue/bulkfetch',
      { data: { issueIdsOrKeys: keys.slice(0, BULK_LIMIT), fields: PICKER_FIELDS } },
      signal,
    );
    return res.issues ?? [];
  } catch (e) {
    // Bulk fetch is a POST, which Jira may reject (403 XSRF) depending on the proxy.
    // Fall back to plain GETs for the first few candidates (recent projects come first).
    if (!(e instanceof ApiError) || e.status === 401) throw e;
    const found = await Promise.all(
      keys.slice(0, GET_FALLBACK_LIMIT).map((key) =>
        jiraGet<PickerIssue>(c, `/issue/${encodeURIComponent(key)}`, { fields: PICKER_FIELDS.join(',') }, signal).catch(
          (err: unknown) => {
            if (err instanceof ApiError && err.status === 401) throw err;
            return null; // 404: no such issue in that project
          },
        ),
      ),
    );
    return found.filter((i): i is PickerIssue => i !== null);
  }
}

/**
 * Issues to log work against. Empty query: your recent issues. Otherwise:
 * - a number ("1234") matches that issue number in any of your projects (NCS-1234, UD-1234, …),
 * - a key with or without the dash ("NCS-1234", "ncs1234") matches that issue,
 * - plus Jira full-text search over summary, description and comments.
 */
async function searchIssueOptions(c: Credentials, query: string, signal?: AbortSignal): Promise<IssueOption[]> {
  const q = query.trim().replace(/["\\]/g, ' ').trim();
  const run = async (jql: string) =>
    (
      await jiraGet<{ issues: PickerIssue[] }>(
        c,
        '/search/jql',
        { jql, fields: PICKER_FIELDS.join(','), maxResults: 20 },
        signal,
      )
    ).issues;

  let issues: PickerIssue[];
  if (!q) {
    issues = await run(RECENT_JQL);
  } else {
    const text = [`text ~ "${q}"`];
    if (!/\s/.test(q) && q.length >= 2) text.push(`summary ~ "${q}*"`);

    const keyMatch = KEY_QUERY_RE.exec(q);
    const byKey = keyMatch
      ? (async () => {
          const [, prefix, num] = keyMatch;
          const keys = prefix
            ? [`${prefix.toUpperCase()}-${Number(num)}`]
            : (await projectKeysFor(c)).map((k) => `${k}-${Number(num)}`);
          try {
            return await fetchByKeys(c, keys, signal);
          } catch (e) {
            // Key lookup is a bonus: never let it hide the text results (except a bad token).
            if (e instanceof ApiError && e.status === 401) throw e;
            if ((e as Error).name === 'AbortError') throw e;
            return [];
          }
        })()
      : Promise.resolve([]);

    const [keyIssues, textIssues] = await Promise.all([byKey, run(`(${text.join(' OR ')}) ORDER BY updated DESC`)]);
    const seen = new Set<string>();
    issues = [...keyIssues, ...textIssues].filter((i) => !seen.has(i.key) && seen.add(i.key));
  }

  return issues.map((i) => {
    const cat = i.fields.status.statusCategory?.key;
    return {
      key: i.key,
      summary: i.fields.summary,
      issueType: i.fields.issuetype.name,
      status: i.fields.status.name,
      statusCategory: cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown',
      projectKey: i.fields.project.key,
      projectName: i.fields.project.name,
    };
  });
}

export interface NewWorklog {
  issueKey: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, local time */
  start: string;
  seconds: number;
  comment: string;
}

/** Jira wants `started` as 2026-10-05T09:00:00.000+0700 (with this browser's UTC offset that day). */
function jiraStarted(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const offsetMin = -new Date(y, m - 1, d, hh, mm).getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date}T${pad(hh)}:${pad(mm)}:00.000${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** Plain text → Atlassian Document Format (one paragraph per line). */
function textToAdf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text
      .split('\n')
      .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  };
}

async function addWorklog(c: Credentials, w: NewWorklog): Promise<void> {
  await jiraRequest(c, 'POST', `/issue/${encodeURIComponent(w.issueKey)}/worklog`, {
    data: {
      started: jiraStarted(w.date, w.start),
      timeSpentSeconds: w.seconds,
      ...(w.comment.trim() ? { comment: textToAdf(w.comment.trim()) } : {}),
    },
  });
}

export const api = {
  me,
  tasks,
  worklogs,
  projects,
  releasePage,
  release,
  releaseIssues,
  searchIssueOptions,
  addWorklog,
};
