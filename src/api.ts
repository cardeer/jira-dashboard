import axios from 'axios';
import type { AdfNode as RichDoc } from '@/lib/adf';
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
  method: 'GET' | 'POST' | 'PUT',
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
      // Honour Jira's Retry-After, but never freeze the UI for long: cap each wait at 10s.
      await sleep(Math.min(Number(res.headers['retry-after']) || 2 ** attempt, 10) * 1000);
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

/**
 * JQL for free-text task search. Matches summary/description/comments and issue keys —
 * with or without the project prefix: "1234" finds NCS-1234, UD-1234…, "ncs1234" finds NCS-1234.
 * Keys are checked first (bulk fetch skips missing ones) so `key in (...)` never fails the search.
 */
async function textJql(c: Credentials, text: string, signal?: AbortSignal): Promise<string> {
  const t = text.trim().replace(/["\\]/g, ' ').trim();
  if (!t) return '';
  const or = [`text ~ "${t}"`];
  if (!/\s/.test(t) && t.length >= 2) or.push(`summary ~ "${t}*"`);
  const m = KEY_QUERY_RE.exec(t);
  if (m) {
    const [, prefix, num] = m;
    const candidates = prefix
      ? [`${prefix.toUpperCase()}-${Number(num)}`]
      : (await projectKeysFor(c)).map((k) => `${k}-${Number(num)}`);
    try {
      const found = await fetchByKeys(c, candidates, signal);
      if (found.length) or.unshift(`key in (${found.map((i) => i.key).join(', ')})`);
    } catch (e) {
      // Key lookup is a bonus: keep the text search (except for a bad token / cancellation).
      if ((e instanceof ApiError && e.status === 401) || (e as Error).name === 'AbortError') throw e;
    }
  }
  return `(${or.join(' OR ')})`;
}

/** JQL for the Tasks page (board filter resolved to its saved filter). */
async function taskJql(c: Credentials, q: TaskQuery, signal?: AbortSignal): Promise<string> {
  const parts: string[] = [];
  if (q.boardId) parts.push(`filter = ${Number(await boardFilterId(c, q.boardId, signal))}`);
  if (q.scope === 'mine') parts.push('assignee = currentUser()');
  parts.push(STATUS_JQL[q.status]);
  const text = await textJql(c, q.text, signal);
  if (text) parts.push(text);
  return `${parts.join(' AND ')} ORDER BY updated DESC`;
}

/** Scope + text part of the task JQL (no board/status/order): narrows sprint & backlog issues. */
async function taskFilterJql(c: Credentials, scope: TaskScope, text: string, signal?: AbortSignal): Promise<string> {
  const parts: string[] = [];
  if (scope === 'mine') parts.push('assignee = currentUser()');
  const t = await textJql(c, text, signal);
  if (t) parts.push(t);
  return parts.join(' AND ');
}

export interface TaskPage {
  tasks: Task[];
  nextPageToken: string | null;
  /** Approximate total matching issues (null if Jira couldn't say). */
  total: number | null;
}

const TASK_FIELDS = [
  'summary', 'status', 'priority', 'issuetype', 'project', 'updated', 'duedate', 'assignee',
  // Plain estimate fields (seconds): present even when the timetracking object is empty.
  'timeoriginalestimate', 'timeestimate',
];

/** Fields to request for task rows, including this site's Tester field. */
async function taskFields(c: Credentials): Promise<{ fields: string[]; ids: CustomFieldIds }> {
  const ids = await customFieldIds(c);
  return { fields: [...TASK_FIELDS, ...(ids.tester ? [ids.tester.id] : [])], ids };
}

/** Jira issue (search or agile response) → task row. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTask(key: string, f: Record<string, any>, ids: CustomFieldIds): Task {
  const secs = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    key,
    summary: f.summary,
    status: f.status?.name,
    statusCategory: toStatusCategory(f.status?.statusCategory?.key),
    priority: f.priority?.name ?? null,
    issueType: f.issuetype?.name,
    projectKey: f.project?.key,
    projectName: f.project?.name,
    updated: f.updated,
    dueDate: f.duedate ?? null,
    assignee: f.assignee ? toPerson(f.assignee) : null,
    estimateSeconds: secs(f.timeoriginalestimate) ?? secs(f.timetracking?.originalEstimateSeconds),
    remainingSeconds: secs(f.timeestimate) ?? secs(f.timetracking?.remainingEstimateSeconds),
    testers: ids.tester ? toPeople(f[ids.tester.id]) : [],
  };
}

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
  interface Res {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    issues: { key: string; fields: Record<string, any> }[];
    nextPageToken?: string;
    isLast?: boolean;
  }
  const [jql, { fields, ids }] = await Promise.all([taskJql(c, q, signal), taskFields(c)]);
  const [res, total] = await Promise.all([
    jiraGet<Res>(
      c,
      '/search/jql',
      { jql, fields: fields.join(','), maxResults: page.size, ...(page.token ? { nextPageToken: page.token } : {}) },
      signal,
    ),
    // Totals are a nice-to-have; never fail the page for them.
    page.count === false
      ? Promise.resolve(null)
      : jiraRequest<{ count: number }>(c, 'POST', '/search/approximate-count', { data: { jql } }, signal).then(
          (r) => r.count,
          () => null,
        ),
  ]);
  return {
    tasks: res.issues.map((i) => toTask(i.key, i.fields, ids)),
    nextPageToken: res.isLast ? null : (res.nextPageToken ?? null),
    total,
  };
}

/** Most tasks "Show all" will load before stopping (and reporting truncation). */
export const SHOW_ALL_CAP = 1000;

/**
 * Every matching task on one page, fetched 100 at a time up to SHOW_ALL_CAP.
 * `onProgress` gets the rows so far after each batch, so the UI can render while loading.
 */
async function tasksAll(
  c: Credentials,
  q: TaskQuery,
  signal?: AbortSignal,
  onProgress?: (tasks: Task[], total: number | null) => void,
): Promise<{ tasks: Task[]; total: number | null; truncated: boolean }> {
  const first = await tasksPage(c, q, { token: null, size: 100 }, signal);
  const tasks = [...first.tasks];
  onProgress?.(tasks.slice(), first.total);
  let token = first.nextPageToken;
  const seen = new Set<string>();
  while (token && tasks.length < SHOW_ALL_CAP) {
    // Defensive: never loop on a token Jira already gave us.
    if (seen.has(token)) break;
    seen.add(token);
    const next = await tasksPage(c, q, { token, size: 100, count: false }, signal);
    if (next.tasks.length === 0) break;
    tasks.push(...next.tasks);
    onProgress?.(tasks.slice(0, SHOW_ALL_CAP), first.total);
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

/* ---------- issue details & editing ---------- */

interface FieldInfo {
  id: string;
  name: string;
  custom?: boolean;
  schema?: { type?: string; custom?: string; items?: string };
}
/** Site-wide field list (custom field ids differ per site). Cached per site. */
const fieldCache = new Map<string, Promise<FieldInfo[]>>();
function fieldList(c: Credentials): Promise<FieldInfo[]> {
  let p = fieldCache.get(c.site);
  if (!p) {
    p = jiraGet<FieldInfo[]>(c, '/field');
    p.catch(() => fieldCache.delete(c.site));
    fieldCache.set(c.site, p);
  }
  return p;
}
export interface CustomFieldIds {
  storyPoints?: string;
  sprint?: string;
  /** The site's "Tester" user field, and whether it holds several people. */
  tester?: { id: string; multi: boolean };
}

/** Ids of the Story points, Sprint and Tester custom fields on this site (if any). */
async function customFieldIds(c: Credentials): Promise<CustomFieldIds> {
  const fields = await fieldList(c);
  const storyPoints =
    fields.find((f) => /^story point estimate$/i.test(f.name)) ??
    fields.find((f) => /^story points?$/i.test(f.name)) ??
    fields.find((f) => f.schema?.custom?.endsWith(':jsw-story-points'));
  const sprint = fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint') ?? fields.find((f) => f.name === 'Sprint');
  const isUserField = (f: FieldInfo) => f.schema?.type === 'user' || (f.schema?.type === 'array' && f.schema.items === 'user');
  const tester =
    fields.find((f) => /^testers?$/i.test(f.name.trim()) && isUserField(f)) ??
    fields.find((f) => /\btesters?\b/i.test(f.name) && isUserField(f));
  return {
    storyPoints: storyPoints?.id,
    sprint: sprint?.id,
    tester: tester ? { id: tester.id, multi: tester.schema?.type === 'array' } : undefined,
  };
}

/** One user or a list of users (multi-user picker) → list of people. */
function toPeople(v: unknown): Person[] {
  if (!v) return [];
  const list = Array.isArray(v) ? v : [v];
  return list.filter((u): u is RawUser => Boolean(u && typeof u === 'object' && 'accountId' in u)).map(toPerson);
}

export interface SprintRef {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed' | string;
}

export interface IssueDetail {
  key: string;
  summary: string;
  description: RichDoc | null;
  /** Jira-rendered HTML for display (sanitise before use). */
  descriptionHtml: string;
  status: string;
  statusCategory: StatusCategory;
  issueType: { name: string; iconUrl?: string };
  project: { key: string; name: string };
  parent: { key: string; summary: string } | null;
  assignee: Person | null;
  reporter: Person | null;
  priority: { id: string; name: string; iconUrl?: string } | null;
  labels: string[];
  dueDate: string | null;
  created: string;
  updated: string;
  fixVersions: { id: string; name: string }[];
  sprints: SprintRef[];
  /** "3h 30m" strings as Jira formats them, plus seconds. */
  timetracking: {
    originalEstimate?: string;
    remainingEstimate?: string;
    timeSpent?: string;
    originalEstimateSeconds?: number;
    remainingEstimateSeconds?: number;
    timeSpentSeconds?: number;
  };
  storyPoints: number | null;
  testers: Person[];
  /** Field ids found on this site (null when the field doesn't exist). */
  fieldIds: { storyPoints: string | null; tester: { id: string; multi: boolean } | null };
}

const toStatusCategory = (key?: string): StatusCategory =>
  key === 'new' || key === 'indeterminate' || key === 'done' ? key : 'unknown';

async function issueDetail(c: Credentials, key: string, signal?: AbortSignal): Promise<IssueDetail> {
  const ids = await customFieldIds(c);
  const fields = [
    'summary', 'description', 'status', 'issuetype', 'project', 'parent', 'assignee', 'reporter', 'priority',
    'labels', 'duedate', 'created', 'updated', 'fixVersions', 'timetracking', 'timeoriginalestimate', 'timeestimate',
    ...(ids.storyPoints ? [ids.storyPoints] : []),
    ...(ids.tester ? [ids.tester.id] : []),
    ...(ids.sprint ? [ids.sprint] : []),
  ];
  const r = await jiraGet<{
    key: string;
    fields: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    renderedFields?: { description?: string };
  }>(c, `/issue/${encodeURIComponent(key)}`, { fields: fields.join(','), expand: 'renderedFields' }, signal);
  const f = r.fields;
  return {
    key: r.key,
    summary: f.summary,
    description: f.description ?? null,
    descriptionHtml: r.renderedFields?.description ?? '',
    status: f.status?.name,
    statusCategory: toStatusCategory(f.status?.statusCategory?.key),
    issueType: { name: f.issuetype?.name, iconUrl: f.issuetype?.iconUrl },
    project: { key: f.project?.key, name: f.project?.name },
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary ?? '' } : null,
    assignee: f.assignee ? toPerson(f.assignee) : null,
    reporter: f.reporter ? toPerson(f.reporter) : null,
    priority: f.priority ? { id: String(f.priority.id), name: f.priority.name, iconUrl: f.priority.iconUrl } : null,
    labels: f.labels ?? [],
    dueDate: f.duedate ?? null,
    created: f.created,
    updated: f.updated,
    fixVersions: (f.fixVersions ?? []).map((v: { id: string; name: string }) => ({ id: String(v.id), name: v.name })),
    sprints: ids.sprint ? ((f[ids.sprint] as SprintRef[] | null) ?? []).map((s) => ({ id: s.id, name: s.name, state: s.state })) : [],
    // Prefer the timetracking object, falling back to the plain estimate fields (seconds).
    timetracking: {
      ...(f.timetracking ?? {}),
      originalEstimateSeconds: f.timetracking?.originalEstimateSeconds ?? f.timeoriginalestimate ?? undefined,
      remainingEstimateSeconds: f.timetracking?.remainingEstimateSeconds ?? f.timeestimate ?? undefined,
    },
    storyPoints: ids.storyPoints && typeof f[ids.storyPoints] === 'number' ? f[ids.storyPoints] : null,
    testers: ids.tester ? toPeople(f[ids.tester.id]) : [],
    fieldIds: { storyPoints: ids.storyPoints ?? null, tester: ids.tester ?? null },
  };
}

export interface EditMeta {
  /** Field ids you may change on this issue. */
  editable: Set<string>;
  priorities: { id: string; name: string; iconUrl?: string }[];
}

async function editMeta(c: Credentials, key: string, signal?: AbortSignal): Promise<EditMeta> {
  const r = await jiraGet<{
    fields: Record<string, { allowedValues?: { id: string; name: string; iconUrl?: string }[] }>;
  }>(c, `/issue/${encodeURIComponent(key)}/editmeta`, {}, signal);
  return {
    editable: new Set(Object.keys(r.fields)),
    priorities: (r.fields.priority?.allowedValues ?? []).map((p) => ({ id: String(p.id), name: p.name, iconUrl: p.iconUrl })),
  };
}

/** Update fields on an issue (only send what changed). */
async function updateIssue(c: Credentials, key: string, fields: Record<string, unknown>): Promise<void> {
  await jiraRequest(c, 'PUT', `/issue/${encodeURIComponent(key)}`, { data: { fields } });
}

/* ---------- sprints & backlog (Agile API) ---------- */

export interface SprintSection {
  id: string;
  name: string;
  state: 'active' | 'future' | 'backlog';
  goal?: string;
  startDate?: string;
  endDate?: string;
  tasks: Task[];
  /** Sum of story points / original estimates in this section (null if none set). */
  storyPoints: number | null;
  estimateSeconds: number;
}

/** Active and future sprints of a board (empty for boards without sprints, e.g. Kanban). */
async function boardSprints(c: Credentials, boardId: string, signal?: AbortSignal) {
  try {
    const r = await agileGet<{
      values: { id: number; name: string; state: string; goal?: string; startDate?: string; endDate?: string }[];
    }>(c, `/board/${encodeURIComponent(boardId)}/sprint`, { state: 'active,future', maxResults: 50 }, signal);
    return r.values;
  } catch (e) {
    // Kanban boards reject the sprint endpoint ("board does not support sprints").
    if (e instanceof ApiError && e.status === 400) return [];
    throw e;
  }
}

/** Issues of one sprint or the backlog, via the Agile API (paged by startAt, up to `cap`). */
async function agileIssues(
  c: Credentials,
  path: string,
  jql: string,
  ids: CustomFieldIds,
  signal?: AbortSignal,
  cap = 500,
): Promise<{ tasks: Task[]; points: number[] }> {
  const fields = [...TASK_FIELDS, 'timetracking', ...(ids.storyPoints ? [ids.storyPoints] : []), ...(ids.tester ? [ids.tester.id] : [])];
  const tasks: Task[] = [];
  const points: number[] = [];
  for (let startAt = 0; ; ) {
    const r = await agileGet<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      issues: { key: string; fields: Record<string, any> }[];
      total?: number;
      isLast?: boolean;
    }>(c, path, { startAt, maxResults: 100, fields: fields.join(','), ...(jql ? { jql } : {}) }, signal);
    for (const i of r.issues) {
      tasks.push(toTask(i.key, i.fields, ids));
      points.push(ids.storyPoints && typeof i.fields[ids.storyPoints] === 'number' ? i.fields[ids.storyPoints] : NaN);
    }
    startAt += r.issues.length;
    if (r.issues.length === 0 || r.isLast || startAt >= (r.total ?? Infinity) || startAt >= cap) break;
  }
  return { tasks, points };
}

/**
 * The board's active and future sprints plus its backlog, each with their issues.
 * `jql` narrows issues (e.g. assignee = currentUser(), text search).
 */
async function sprintBoard(
  c: Credentials,
  boardId: string,
  filter: { scope: TaskScope; text: string },
  signal?: AbortSignal,
): Promise<SprintSection[]> {
  const [ids, sprints, jql] = await Promise.all([
    customFieldIds(c),
    boardSprints(c, boardId, signal),
    taskFilterJql(c, filter.scope, filter.text, signal),
  ]);
  const b = encodeURIComponent(boardId);
  const sections = [
    ...sprints
      .sort((x, y) => (x.state === y.state ? 0 : x.state === 'active' ? -1 : 1))
      .map((s) => ({ meta: { id: String(s.id), name: s.name, state: s.state as 'active' | 'future', goal: s.goal, startDate: s.startDate, endDate: s.endDate }, path: `/board/${b}/sprint/${s.id}/issue` })),
    { meta: { id: 'backlog', name: 'Backlog', state: 'backlog' as const }, path: `/board/${b}/backlog` },
  ];
  return Promise.all(
    sections.map(async ({ meta, path }) => {
      const { tasks, points } = await agileIssues(c, path, jql, ids, signal);
      const known = points.filter((p) => !Number.isNaN(p));
      return {
        ...meta,
        tasks,
        storyPoints: known.length ? known.reduce((a, b2) => a + b2, 0) : null,
        estimateSeconds: tasks.reduce((a, t) => a + (t.estimateSeconds ?? 0), 0),
      };
    }),
  );
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
  /** Rich text as ADF; null = no description. */
  description: RichDoc | null;
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
        ...(n.description ? { description: n.description } : {}),
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

/**
 * The saved filter behind a board. Cached: it rarely changes.
 * The shared request deliberately ignores callers' AbortSignals: if the first caller is cancelled
 * (e.g. React StrictMode's double mount, or a quick filter change), later callers reuse the same
 * promise and must not receive that caller's AbortError. Each caller can still stop waiting.
 */
const boardFilterCache = new Map<string, Promise<string>>();
function boardFilterId(c: Credentials, boardId: string, signal?: AbortSignal): Promise<string> {
  const id = `${c.site}|${boardId}`;
  let p = boardFilterCache.get(id);
  if (!p) {
    p = agileGet<{ filter: { id: string | number } }>(c, `/board/${encodeURIComponent(boardId)}/configuration`).then(
      (cfg) => String(cfg.filter.id),
    );
    p.catch(() => boardFilterCache.delete(id));
    boardFilterCache.set(id, p);
  }
  return signal ? raceAbort(p, signal) : p;
}

/** Resolve like `p`, but reject with AbortError as soon as `signal` aborts (without cancelling `p`). */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
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
  issueDetail,
  editMeta,
  updateIssue,
  sprintBoard,
  customFieldIds,
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
