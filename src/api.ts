import axios from 'axios';
import type {
  Credentials,
  Me,
  Person,
  Release,
  ReleaseIssue,
  StatusCategory,
  Task,
  TaskFilter,
  TaskScope,
  WorklogEntry,
  WorklogScope,
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
const API_PATHS = { core: '/rest/api/3', agile: '/rest/agile/1.0' } as const;
const jiraBase = (c: Credentials, api: keyof typeof API_PATHS = 'core') =>
  `/api/jira/${new URL(c.site).hostname.split('.')[0]}${API_PATHS[api]}`;

/** Talks to Jira Cloud through the same-origin rewrite, using axios. */
async function jiraRequest<T>(
  c: Credentials,
  method: 'GET' | 'POST',
  path: string,
  opts: { params?: Record<string, string | number>; data?: unknown; api?: keyof typeof API_PATHS } = {},
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await axios.request({
        method,
        url: `${jiraBase(c, opts.api)}${path}`,
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
const agileGet = <T,>(c: Credentials, path: string, params: Record<string, string | number> = {}, signal?: AbortSignal) =>
  jiraRequest<T>(c, 'GET', path, { params, api: 'agile' }, signal);

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

interface RawUser {
  accountId: string;
  accountType?: string;
  active?: boolean;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}
const toPerson = (u: RawUser): Person => ({
  accountId: u.accountId,
  displayName: u.displayName,
  email: u.emailAddress,
  avatarUrl: u.avatarUrls?.['48x48'] ?? u.avatarUrls?.['32x32'],
});

async function me(c: Credentials, signal?: AbortSignal): Promise<Me> {
  return toPerson(await jiraGet<RawUser>(c, '/myself', {}, signal));
}

/** One user by account id (e.g. when a ?user= link is opened). */
async function user(c: Credentials, accountId: string, signal?: AbortSignal): Promise<Person> {
  return toPerson(await jiraGet<RawUser>(c, '/user', { accountId }, signal));
}

/**
 * Active people matching a name or email. Needs the "Browse users and groups" permission;
 * Jira returns 403 without it.
 */
async function searchUsers(c: Credentials, query: string, signal?: AbortSignal): Promise<Person[]> {
  const users = await jiraGet<RawUser[]>(c, '/user/search', { query, maxResults: 20 }, signal);
  return users.filter((u) => u.active !== false && (u.accountType ?? 'atlassian') === 'atlassian').map(toPerson);
}

const STATUS_JQL: Record<TaskFilter, string> = {
  open: 'statusCategory != Done',
  done: 'statusCategory = Done AND updated >= -30d',
  all: '(statusCategory != Done OR updated >= -30d)',
};

export interface TaskQuery {
  scope: TaskScope;
  status: TaskFilter;
  boardId: string | null;
  /** Free text: key, summary or description. */
  text: string;
}

/** JQL for the Tasks page (board filter resolved to its saved filter). */
async function taskJql(c: Credentials, q: TaskQuery, signal?: AbortSignal): Promise<{ jql: string; withKey: boolean }> {
  const parts: string[] = [];
  if (q.boardId) parts.push(`filter = ${Number(await boardFilterId(c, q.boardId, signal))}`);
  if (q.scope === 'mine') parts.push('assignee = currentUser()');
  parts.push(STATUS_JQL[q.status]);
  const t = q.text.trim().replace(/["\\]/g, ' ').trim();
  let withKey = false;
  if (t) {
    const text = [`text ~ "${t}"`];
    if (!/\s/.test(t) && t.length >= 2) text.push(`summary ~ "${t}*"`);
    if (/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(t)) {
      text.unshift(`key = "${t.toUpperCase()}"`);
      withKey = true;
    }
    parts.push(`(${text.join(' OR ')})`);
  }
  return { jql: `${parts.join(' AND ')} ORDER BY updated DESC`, withKey };
}

export interface TaskPage {
  tasks: Task[];
  nextPageToken: string | null;
  /** Approximate total matching issues (null if Jira couldn't say). */
  total: number | null;
}

const TASK_FIELDS = ['summary', 'status', 'priority', 'issuetype', 'project', 'updated', 'duedate', 'assignee'];

/**
 * One page of tasks. Jira's search pages forward with tokens (no random access), so callers
 * keep the token for each page they've visited.
 */
async function tasksPage(
  c: Credentials,
  q: TaskQuery,
  page: { token: string | null; size: number; count?: boolean },
  signal?: AbortSignal,
): Promise<TaskPage> {
  interface F {
    summary: string;
    status: { name: string; statusCategory?: { key: string } };
    priority?: { name: string } | null;
    issuetype: { name: string };
    project: { key: string; name: string };
    updated: string;
    duedate: string | null;
    assignee?: RawUser | null;
  }
  interface Res {
    issues: { key: string; fields: F }[];
    nextPageToken?: string;
    isLast?: boolean;
  }
  let { jql, withKey } = await taskJql(c, q, signal);
  const run = (j: string) =>
    Promise.all([
      jiraGet<Res>(
        c,
        '/search/jql',
        { jql: j, fields: TASK_FIELDS.join(','), maxResults: page.size, ...(page.token ? { nextPageToken: page.token } : {}) },
        signal,
      ),
      // Totals are a nice-to-have; never fail the page for them.
      page.count === false
        ? Promise.resolve(null)
        : jiraRequest<{ count: number }>(c, 'POST', '/search/approximate-count', { data: { jql: j } }, signal).then(
            (r) => r.count,
            () => null,
          ),
    ]);
  let res: Res;
  let total: number | null;
  try {
    [res, total] = await run(jql);
  } catch (e) {
    // `key = X` errors when that project/issue doesn't exist: retry as plain text search.
    if (!withKey || !(e instanceof ApiError) || e.status !== 400) throw e;
    ({ jql } = await taskJql(c, { ...q, text: q.text.replace(/-/g, ' ') }, signal));
    [res, total] = await run(jql);
  }
  return {
    tasks: res.issues.map((i) => {
      const cat = i.fields.status.statusCategory?.key;
      return {
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status.name,
        statusCategory: cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown',
        priority: i.fields.priority?.name ?? null,
        issueType: i.fields.issuetype.name,
        projectKey: i.fields.project.key,
        projectName: i.fields.project.name,
        updated: i.fields.updated,
        dueDate: i.fields.duedate,
        assignee: i.fields.assignee ? toPerson(i.fields.assignee) : null,
      };
    }),
    nextPageToken: res.isLast ? null : (res.nextPageToken ?? null),
    total,
  };
}

/** Most tasks "Show all" will load before stopping (and reporting truncation). */
export const SHOW_ALL_CAP = 1000;

/** Every matching task on one page, fetched 100 at a time up to SHOW_ALL_CAP. */
async function tasksAll(
  c: Credentials,
  q: TaskQuery,
  signal?: AbortSignal,
): Promise<{ tasks: Task[]; total: number | null; truncated: boolean }> {
  const first = await tasksPage(c, q, { token: null, size: 100 }, signal);
  const tasks = [...first.tasks];
  let token = first.nextPageToken;
  while (token && tasks.length < SHOW_ALL_CAP) {
    const next = await tasksPage(c, q, { token, size: 100, count: false }, signal);
    tasks.push(...next.tasks);
    token = next.nextPageToken;
  }
  return { tasks: tasks.slice(0, SHOW_ALL_CAP), total: first.total, truncated: Boolean(token) || tasks.length > SHOW_ALL_CAP };
}

export interface Transition {
  id: string;
  name: string;
  to: { name: string; statusCategory: StatusCategory };
}

/** Workflow moves available for an issue right now (depends on its current status and your permissions). */
async function transitions(c: Credentials, issueKey: string, signal?: AbortSignal): Promise<Transition[]> {
  const res = await jiraGet<{
    transitions: { id: string; name: string; to: { name: string; statusCategory?: { key: string } } }[];
  }>(c, `/issue/${encodeURIComponent(issueKey)}/transitions`, {}, signal);
  return res.transitions.map((t) => {
    const cat = t.to.statusCategory?.key;
    return {
      id: t.id,
      name: t.name,
      to: { name: t.to.name, statusCategory: cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown' },
    };
  });
}

async function transitionIssue(c: Credentials, issueKey: string, transitionId: string): Promise<void> {
  await jiraRequest(c, 'POST', `/issue/${encodeURIComponent(issueKey)}/transitions`, {
    data: { transition: { id: transitionId } },
  });
}

export interface IssueTypeOption {
  id: string;
  name: string;
  iconUrl?: string;
}

/** Issue types you can create in a project (sub-tasks excluded: they need a parent). */
async function issueTypes(c: Credentials, projectKey: string, signal?: AbortSignal): Promise<IssueTypeOption[]> {
  const res = await jiraGet<{ issueTypes?: RawIssueType[]; values?: RawIssueType[] }>(
    c,
    `/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
    { maxResults: 50 },
    signal,
  );
  return (res.issueTypes ?? res.values ?? [])
    .filter((t) => !t.subtask)
    .map((t) => ({ id: String(t.id), name: t.name, iconUrl: t.iconUrl }));
}
interface RawIssueType {
  id: string | number;
  name: string;
  subtask?: boolean;
  iconUrl?: string;
}

/** People who can be assigned issues in a project. */
async function assignableUsers(c: Credentials, projectKey: string, query: string, signal?: AbortSignal): Promise<Person[]> {
  const users = await jiraGet<RawUser[]>(
    c,
    '/user/assignable/search',
    { project: projectKey, maxResults: 20, ...(query.trim() ? { query: query.trim() } : {}) },
    signal,
  );
  return users.filter((u) => u.active !== false && (u.accountType ?? 'atlassian') === 'atlassian').map(toPerson);
}

export interface NewIssue {
  projectKey: string;
  issueTypeId: string;
  summary: string;
  description: string;
  /** accountId; null = unassigned */
  assigneeId: string | null;
}

async function createIssue(c: Credentials, n: NewIssue): Promise<{ key: string }> {
  return jiraRequest<{ key: string }>(c, 'POST', '/issue', {
    data: {
      fields: {
        project: { key: n.projectKey },
        issuetype: { id: n.issueTypeId },
        summary: n.summary.trim(),
        ...(n.description.trim() ? { description: textToAdf(n.description.trim()) } : {}),
        ...(n.assigneeId ? { assignee: { accountId: n.assigneeId } } : {}),
      },
    },
  });
}

/** Max issues scanned for one work log query; beyond this the result is marked truncated. */
const WORKLOG_ISSUE_CAP = { person: 500, all: 1000 };

export interface WorklogResult {
  entries: WorklogEntry[];
  /** True when more issues matched than were scanned (narrow the date range). */
  truncated: boolean;
}

/**
 * Worklogs between two dates (inclusive), across every project you can browse, for one person
 * (account id; null = you) or everyone ('all').
 */
async function worklogs(
  c: Credentials,
  from: string,
  to: string,
  scope: WorklogScope | null,
  boardId: string | null,
  signal?: AbortSignal,
): Promise<WorklogResult> {
  const everyone = scope === 'all';
  // A board is defined by a saved filter; `filter = <id>` limits issues to the board's.
  const boardJql = boardId ? `filter = ${Number(await boardFilterId(c, boardId, signal))} AND ` : '';
  const authorId = everyone ? null : (scope ?? (await me(c, signal)).accountId);

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
  const dateJql = `worklogDate >= "${pad(from, -1)}" AND worklogDate <= "${pad(to, 1)}"`;
  const cap = everyone ? WORKLOG_ISSUE_CAP.all : WORKLOG_ISSUE_CAP.person;
  const issues = await searchIssues<F>(
    c,
    `${boardJql}${authorId ? `worklogAuthor = "${authorId}" AND ` : ''}${dateJql}`,
    ['summary', 'status', 'issuetype', 'project'],
    signal,
    cap,
  );

  interface RawWorklog {
    id: string;
    author?: { accountId: string; displayName?: string; avatarUrls?: Record<string, string> };
    started: string;
    timeSpentSeconds: number;
    comment?: AdfNode | string;
  }
  // Only ask Jira for worklogs inside the (padded) window, so busy issues stay cheap.
  const startedAfter = Date.parse(`${pad(from, -1)}T00:00:00Z`);
  const startedBefore = Date.parse(`${pad(to, 2)}T00:00:00Z`);

  const fetchIssueWorklogs = async (issue: (typeof issues)[number]) => {
    const out: WorklogEntry[] = [];
    let startAt = 0;
    for (;;) {
      const page = await jiraGet<{ worklogs: RawWorklog[]; total: number }>(
        c,
        `/issue/${issue.key}/worklog`,
        { startAt, maxResults: 1000, startedAfter, startedBefore },
        signal,
      );
      for (const w of page.worklogs) {
        if (!w.author || (authorId && w.author.accountId !== authorId)) continue;
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
          authorId: w.author.accountId,
          authorName: w.author.displayName ?? 'Unknown',
          authorAvatar: w.author.avatarUrls?.['48x48'] ?? w.author.avatarUrls?.['32x32'],
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

  return {
    entries: results.flat().sort((a, b) => (a.started < b.started ? 1 : -1)),
    truncated: issues.length >= cap,
  };
}

export interface Board {
  id: string;
  name: string;
  type: string;
  /** e.g. "Nipa Cloud Service (NCS)" */
  location?: string;
  projectKey?: string;
}

interface RawBoard {
  id: number;
  name: string;
  type: string;
  location?: { displayName?: string; projectName?: string; projectKey?: string };
}
const toBoard = (b: RawBoard): Board => ({
  id: String(b.id),
  name: b.name,
  type: b.type,
  location: b.location?.displayName ?? (b.location?.projectName ? `${b.location.projectName} (${b.location.projectKey})` : undefined),
  projectKey: b.location?.projectKey,
});

/** Boards you can see, optionally matching a name (Jira Software Agile API). */
async function boards(c: Credentials, name: string, signal?: AbortSignal): Promise<Board[]> {
  const res = await agileGet<{ values: RawBoard[] }>(
    c,
    '/board',
    { maxResults: 50, ...(name.trim() ? { name: name.trim() } : {}) },
    signal,
  );
  return res.values.map(toBoard);
}

async function board(c: Credentials, boardId: string, signal?: AbortSignal): Promise<Board> {
  return toBoard(await agileGet<RawBoard>(c, `/board/${encodeURIComponent(boardId)}`, {}, signal));
}

/** The saved filter behind a board. Cached: it rarely changes. */
const boardFilterCache = new Map<string, Promise<string>>();
function boardFilterId(c: Credentials, boardId: string, signal?: AbortSignal): Promise<string> {
  const id = `${c.site}|${boardId}`;
  let p = boardFilterCache.get(id);
  if (!p) {
    p = agileGet<{ filter: { id: string | number } }>(c, `/board/${encodeURIComponent(boardId)}/configuration`, {}, signal).then(
      (cfg) => String(cfg.filter.id),
    );
    p.catch(() => boardFilterCache.delete(id));
    boardFilterCache.set(id, p);
  }
  return p;
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
  user,
  boards,
  board,
  searchUsers,
  tasksPage,
  tasksAll,
  transitions,
  transitionIssue,
  issueTypes,
  assignableUsers,
  createIssue,
  worklogs,
  projects,
  releasePage,
  release,
  releaseIssues,
  searchIssueOptions,
  addWorklog,
};
