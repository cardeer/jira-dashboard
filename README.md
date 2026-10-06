# Jira Dashboard (axios + rewrite)

Personal dashboard for Jira Cloud: your assigned tasks, plus **your own** work logs across **all projects/teams**, with the task each entry was logged against.

- React + TypeScript (Vite), all HTTP via **axios**, no server code
- UI: [shadcn/ui](https://ui.shadcn.com) (Radix + Tailwind v4) with a Jira-style blue / navy theme (`src/index.css`)
- Routing: React Router with real URLs — `/worklogs`, `/tasks`, `/releases`, `/releases/:project/:id`.
  Filters, date range, view and page live in the query string, so Back/Forward, refresh and shared links work.
- Sign in with Jira site + Atlassian email + [API token](https://id.atlassian.com/manage-profile/security/api-tokens); saved in the browser's `localStorage`
- Jira Cloud blocks cross-origin browser calls (CORS), so the browser calls a same-origin path instead:
  `/api/jira/<site>/<path>` → `https://<site>.atlassian.net/<path>`
  - **Vercel:** done by the rewrite in `vercel.json`
  - **Local dev / `vite preview`:** done by a small plugin in `vite.config.ts`

## Run

```bash
npm install
npm run dev
```

Deploy to Vercel (framework preset: Vite). Only `<name>.atlassian.net` sites are supported.

## If the Vercel rewrite fails

The destination uses a path parameter in the hostname (`https://:site.atlassian.net/:path*`). If Vercel doesn't
substitute it, hard-code your site instead:

```json
{ "rewrites": [{ "source": "/api/jira/:site/:path*", "destination": "https://yourcompany.atlassian.net/:path*" }] }
```
