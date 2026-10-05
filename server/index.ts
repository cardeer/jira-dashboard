import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JiraClient, JiraError, normalizeSite } from './jira';
import type { TaskFilter } from '../shared/types';

const app = express();

declare module 'express-serve-static-core' {
  interface Request {
    jira?: JiraClient;
  }
}

// Stateless: credentials come from the browser on every request and are never stored here.
function withJira(req: Request, _res: Response, next: NextFunction) {
  try {
    const site = normalizeSite(String(req.header('x-jira-site') ?? ''));
    const email = String(req.header('x-jira-email') ?? '').trim();
    const token = String(req.header('x-jira-token') ?? '').trim();
    if (!email || !token) throw new JiraError(401, 'Missing email or API token');
    req.jira = new JiraClient(site, email, token);
    next();
  } catch (e) {
    next(e);
  }
}

const handler =
  (fn: (req: Request, jira: JiraClient) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req, req.jira!));
    } catch (e) {
      next(e);
    }
  };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get('/api/me', withJira, handler((_req, jira) => jira.myself()));

app.get(
  '/api/tasks',
  withJira,
  handler((req, jira) => {
    const f = String(req.query.filter ?? 'open');
    const filter: TaskFilter = f === 'done' || f === 'all' ? f : 'open';
    return jira.tasks(filter);
  }),
);

app.get(
  '/api/worklogs',
  withJira,
  handler((req, jira) => {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      throw new JiraError(400, 'from/to must be YYYY-MM-DD with from <= to');
    }
    return jira.worklogs(from, to);
  }),
);

// Serve the built frontend when present (npm run build && npm start).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) =>
    req.path.startsWith('/api') ? next() : res.sendFile(path.join(dist, 'index.html')),
  );
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof JiraError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(502).json({ error: 'Could not reach Jira' });
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
app.listen(port, host, () => console.log(`Jira proxy listening on http://${host}:${port}`));
