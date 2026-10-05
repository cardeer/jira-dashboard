import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi, toHttpError } from '../server/api.js';

// Vercel serverless entry: handles /api/me, /api/tasks and /api/worklogs.
export default async function handler(
  req: IncomingMessage & { query?: Record<string, string | string[] | undefined> },
  res: ServerResponse,
) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  try {
    const q = req.query ?? {};
    send(200, await handleApi(first(q.route) ?? '', (n) => first(req.headers[n]), (n) => first(q[n])));
  } catch (e) {
    const { status, error } = toHttpError(e);
    send(status, { error });
  }
}
