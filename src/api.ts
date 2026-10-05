import type { Credentials, Me, Task, TaskFilter, WorklogEntry } from '../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(creds: Credentials, path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${creds.proxy ?? ''}${path}`, {
      signal,
      headers: {
        'x-jira-site': creds.site,
        'x-jira-email': creds.email,
        'x-jira-token': creds.token,
      },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Cannot reach the dashboard server. Is it running?');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  me: (c: Credentials, signal?: AbortSignal) => request<Me>(c, '/api/me', signal),
  tasks: (c: Credentials, filter: TaskFilter, signal?: AbortSignal) =>
    request<Task[]>(c, `/api/tasks?filter=${filter}`, signal),
  worklogs: (c: Credentials, from: string, to: string, signal?: AbortSignal) =>
    request<WorklogEntry[]>(c, `/api/worklogs?from=${from}&to=${to}`, signal),
};
