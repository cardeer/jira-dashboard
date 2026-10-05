import axios from 'axios';
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
  try {
    const res = await axios.get<T>(`${creds.proxy ?? ''}${path}`, {
      signal,
      headers: {
        'x-jira-site': creds.site,
        'x-jira-email': creds.email,
        'x-jira-token': creds.token,
      },
    });
    return res.data;
  } catch (e) {
    // Callers (useAsync, App) treat AbortError as "superseded request: ignore".
    if (axios.isCancel(e)) throw new DOMException('Aborted', 'AbortError');
    if (axios.isAxiosError<{ error?: string }>(e)) {
      if (!e.response) throw new ApiError(0, 'Cannot reach the dashboard server. Is it running?');
      throw new ApiError(e.response.status, e.response.data?.error ?? `Request failed (${e.response.status})`);
    }
    throw e;
  }
}

export const api = {
  me: (c: Credentials, signal?: AbortSignal) => request<Me>(c, '/api/me', signal),
  tasks: (c: Credentials, filter: TaskFilter, signal?: AbortSignal) =>
    request<Task[]>(c, `/api/tasks?filter=${filter}`, signal),
  worklogs: (c: Credentials, from: string, to: string, signal?: AbortSignal) =>
    request<WorklogEntry[]>(c, `/api/worklogs?from=${from}&to=${to}`, signal),
};
