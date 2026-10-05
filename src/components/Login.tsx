import { useState, type FormEvent } from 'react';
import type { Credentials, Me } from '../../shared/types';
import { api } from '../api';
import { normalizeSite } from '../auth';

interface Props {
  initialError?: string;
  onLogin: (creds: Credentials, me: Me) => void;
}

export default function Login({ initialError, onLogin }: Props) {
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    let creds: Credentials;
    try {
      creds = { site: normalizeSite(site), email: email.trim(), token: token.trim() };
    } catch {
      setError('That does not look like a valid Jira site address.');
      return;
    }
    setBusy(true);
    try {
      const me = await api.me(creds);
      onLogin(creds, me);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Jira Dashboard</h1>
        <p className="muted">Sign in with your Atlassian API token to see your tasks and work logs.</p>

        <label>
          Jira site
          <input
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="yourcompany.atlassian.net"
            autoComplete="url"
            required
            autoFocus
          />
        </label>
        <label>
          Atlassian email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="username"
            required
          />
        </label>
        <label>
          API token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <a
          className="hint"
          href="https://id.atlassian.com/manage-profile/security/api-tokens"
          target="_blank"
          rel="noreferrer"
        >
          Create an API token ↗
        </a>

        {error && <div className="alert" role="alert">{error}</div>}

        <button className="btn primary" disabled={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <p className="muted small">
          Your token is saved in this browser’s local storage and sent only to this dashboard’s own
          server, which forwards it to Jira. Sign out to remove it.
        </p>
      </form>
    </main>
  );
}
