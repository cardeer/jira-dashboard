# Jira Dashboard

Personal dashboard for Jira Cloud: your assigned tasks, plus **your own** work logs across **all projects/teams**, with the task each entry was logged against.

- React + TypeScript (Vite) frontend, Express + TypeScript proxy server
- Sign in with Jira site + Atlassian email + [API token](https://id.atlassian.com/manage-profile/security/api-tokens) on first visit; credentials are saved in the browser's `localStorage`
- The server is a stateless proxy (Jira Cloud blocks direct browser calls with API tokens); it never stores credentials

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (proxy on :3001)
```

Production-style:

```bash
npm run build && npm start   # http://127.0.0.1:3001
```

`PORT` / `HOST` env vars override the server bind address (default `127.0.0.1`).

## How work logs are found

1. `worklogAuthor = currentUser() AND worklogDate in range` finds every issue (any project) you logged on.
2. Each issue's worklogs are fetched and filtered to your `accountId` and the exact date range.
