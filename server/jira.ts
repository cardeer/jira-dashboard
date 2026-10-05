import axios from 'axios';
import type { Me, StatusCategory, Task, TaskFilter, WorklogEntry } from '../shared/types';

export class JiraError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Accepts "acme", "acme.atlassian.net" or a full URL; returns https origin or throws. */
export function normalizeSite(input: string): string {
  let raw = input.trim();
  if (!raw) throw new JiraError(400, 'Missing Jira site');
  if (!raw.includes('.') && !raw.includes('/')) raw = `${raw}.atlassian.net`;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JiraError(400, 'Invalid Jira site URL');
  }
  // Restricting to Atlassian Cloud keeps this proxy from being used to reach arbitrary hosts.
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.atlassian.net')) {
    throw new JiraError(400, 'Jira site must be an https://<name>.atlassian.net address');
  }
  return url.origin;
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
  // Block containers hold paragraphs; join those on new lines. Paragraphs hold inline nodes.
  const blockContainer = ['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote'];
  return (node.content ?? []).map(adfToText).join(blockContainer.includes(node.type ?? '') ? '\n' : '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JiraClient {
  private auth: string;

  constructor(
    public readonly site: string,
    email: string,
    token: string,
  ) {
    this.auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  }

  async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      // validateStatus: always resolve, so non-2xx handling stays in one place below.
      const res = await axios.get(`${this.site}/rest/api/3${path}`, {
        params,
        headers: { Authorization: this.auth, Accept: 'application/json' },
        validateStatus: () => true,
        timeout: 30_000,
      });
      if (res.status === 429 && attempt < 3) {
        const wait = Number(res.headers['retry-after']) || 2 ** attempt;
        await sleep(wait * 1000);
        continue;
      }
      if (res.status >= 400) {
        if (res.status === 401) throw new JiraError(401, 'Jira rejected the email / API token');
        if (res.status === 403) throw new JiraError(403, 'Jira denied access to this resource');
        const body = res.data as { errorMessages?: string[] } | string | undefined;
        const detail =
          typeof body === 'object' && body?.errorMessages?.length
            ? body.errorMessages.join('; ')
            : String(typeof body === 'string' ? body : JSON.stringify(body ?? '')).slice(0, 300);
        throw new JiraError(res.status, `Jira error ${res.status}: ${detail}`);
      }
      return res.data as T;
    }
  }

  async myself(): Promise<Me> {
    const u = await this.get<{ accountId: string; displayName: string; emailAddress?: string }>(
      '/myself',
    );
    return { accountId: u.accountId, displayName: u.displayName, email: u.emailAddress };
  }

  private async searchIssues<F>(jql: string, fields: string[], cap = 1000) {
    interface Page {
      issues: { key: string; fields: F }[];
      nextPageToken?: string;
      isLast?: boolean;
    }
    const out: Page['issues'] = [];
    let nextPageToken: string | undefined;
    do {
      const page: Page = await this.get<Page>('/search/jql', {
        jql,
        fields: fields.join(','),
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      out.push(...page.issues);
      nextPageToken = page.isLast ? undefined : page.nextPageToken;
    } while (nextPageToken && out.length < cap);
    return out;
  }

  async tasks(filter: TaskFilter): Promise<Task[]> {
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
    const issues = await this.searchIssues<F>(
      `assignee = currentUser() AND ${clause} ORDER BY updated DESC`,
      ['summary', 'status', 'priority', 'issuetype', 'project', 'updated', 'duedate'],
    );
    return issues.map((i) => {
      const cat = i.fields.status.statusCategory?.key;
      const statusCategory: StatusCategory =
        cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown';
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
  async worklogs(from: string, to: string): Promise<WorklogEntry[]> {
    const me = await this.myself();

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
    const issues = await this.searchIssues<F>(
      `worklogAuthor = currentUser() AND worklogDate >= "${pad(from, -1)}" AND worklogDate <= "${pad(to, 1)}"`,
      ['summary', 'status', 'issuetype', 'project'],
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
      const mine: WorklogEntry[] = [];
      let startAt = 0;
      for (;;) {
        const page = await this.get<{ worklogs: RawWorklog[]; total: number }>(
          `/issue/${issue.key}/worklog`,
          { startAt, maxResults: 1000 },
        );
        for (const w of page.worklogs) {
          if (w.author?.accountId !== me.accountId) continue;
          const date = w.started.slice(0, 10);
          if (date < from || date > to) continue;
          mine.push({
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
      return mine;
    };

    // Small worker pool so we stay well under Jira's rate limits.
    const results: WorklogEntry[][] = new Array(issues.length);
    let next = 0;
    const worker = async () => {
      while (next < issues.length) {
        const idx = next++;
        results[idx] = await fetchIssueWorklogs(issues[idx]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, issues.length) }, worker));

    return results.flat().sort((a, b) => (a.started < b.started ? 1 : -1));
  }
}
