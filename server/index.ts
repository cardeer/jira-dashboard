import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleApi, toHttpError } from './api.js';

const app = express();

// Only needed when the frontend is hosted on another origin (e.g. GitHub Pages).
// Auth is via request headers, not cookies, so no credentialed CORS is involved.
const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'x-jira-site, x-jira-email, x-jira-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    // Chrome's Private Network Access: lets an https page reach http://localhost.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/api/:route', async (req, res, next) => {
  try {
    const q = (n: string) => (typeof req.query[n] === 'string' ? (req.query[n] as string) : undefined);
    res.json(await handleApi(req.params.route, (n) => req.header(n), q));
  } catch (e) {
    next(e);
  }
});

// Serve the built frontend when present (npm run build && npm start).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) =>
    req.path.startsWith('/api') ? next() : res.sendFile(path.join(dist, 'index.html')),
  );
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const { status, error } = toHttpError(err);
  res.status(status).json({ error });
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
app.listen(port, host, () => console.log(`Jira proxy listening on http://${host}:${port}`));
