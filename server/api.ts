import { JiraClient, JiraError, normalizeSite } from './jira.js';
import type { TaskFilter } from '../shared/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Framework-agnostic API: shared by the Express server (local / self-hosted) and the
 * Vercel serverless function. Credentials arrive per request and are never stored.
 */
export async function handleApi(
  route: string,
  header: (name: string) => string | undefined,
  query: (name: string) => string | undefined,
): Promise<unknown> {
  if (!['me', 'tasks', 'worklogs'].includes(route)) throw new JiraError(404, 'Not found');

  const site = normalizeSite(header('x-jira-site') ?? '');
  const email = (header('x-jira-email') ?? '').trim();
  const token = (header('x-jira-token') ?? '').trim();
  if (!email || !token) throw new JiraError(401, 'Missing email or API token');
  const jira = new JiraClient(site, email, token);

  switch (route) {
    case 'me':
      return jira.myself();
    case 'tasks': {
      const f = query('filter');
      const filter: TaskFilter = f === 'done' || f === 'all' ? f : 'open';
      return jira.tasks(filter);
    }
    default: {
      const from = query('from') ?? '';
      const to = query('to') ?? '';
      if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
        throw new JiraError(400, 'from/to must be YYYY-MM-DD with from <= to');
      }
      return jira.worklogs(from, to);
    }
  }
}

/** Maps any thrown error to an HTTP status + message. */
export function toHttpError(err: unknown): { status: number; error: string } {
  if (err instanceof JiraError) return { status: err.status, error: err.message };
  console.error(err);
  return { status: 502, error: 'Could not reach Jira' };
}
