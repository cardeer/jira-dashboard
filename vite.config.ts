import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev/preview stand-in for the rewrite in vercel.json:
 * /api/jira/<site>/<path> -> https://<site>.atlassian.net/<path>
 */
function jiraRewrite(): Plugin {
  const handler = async (
    req: { url?: string; headers: Record<string, string | string[] | undefined> },
    res: { statusCode: number; setHeader(k: string, v: string): void; end(b?: Buffer): void },
  ) => {
    const m = /^\/([a-z0-9-]+)(\/rest\/.*)$/i.exec(req.url ?? '');
    if (!m) {
      res.statusCode = 404;
      res.end();
      return;
    }
    try {
      const r = await fetch(`https://${m[1]}.atlassian.net${m[2]}`, {
        headers: { authorization: String(req.headers.authorization ?? ''), accept: 'application/json' },
      });
      res.statusCode = r.status;
      res.setHeader('content-type', r.headers.get('content-type') ?? 'application/json');
      const retry = r.headers.get('retry-after');
      if (retry) res.setHeader('retry-after', retry);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.statusCode = 502;
      res.end();
    }
  };
  return {
    name: 'jira-rewrite',
    configureServer: (server) => void server.middlewares.use('/api/jira', handler),
    configurePreviewServer: (server) => void server.middlewares.use('/api/jira', handler),
  };
}

export default defineConfig({
  plugins: [react(), jiraRewrite()],
  base: './',
});
