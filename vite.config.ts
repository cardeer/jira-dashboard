import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev/preview stand-in for the rewrite in vercel.json:
 * /api/jira/<site>/<path> -> https://<site>.atlassian.net/<path>
 */
function jiraRewrite(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const m = /^\/([a-z0-9-]+)(\/rest\/.*)$/i.exec(req.url ?? '');
    if (!m) {
      res.statusCode = 404;
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const header = (name: string) => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      const forward: Record<string, string> = { accept: 'application/json' };
      for (const name of ['authorization', 'content-type', 'x-atlassian-token']) {
        const v = header(name);
        if (v) forward[name] = v;
      }
      const r = await fetch(`https://${m[1]}.atlassian.net${m[2]}`, {
        method: req.method,
        headers: forward,
        body: chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined,
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
  plugins: [react(), tailwindcss(), jiraRewrite()],
  // Absolute base: client-side routes like /releases/PAY/123 must still load /assets/*.
  base: '/',
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
});
