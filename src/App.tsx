import { useCallback, useEffect, useState } from 'react';
import type { Credentials, Me } from '../shared/types';
import { api, ApiError } from './api';
import { clearCredentials, loadCredentials, saveCredentials } from './auth';
import Login from './components/Login';
import Releases from './components/Releases';
import Tasks from './components/Tasks';
import Worklogs from './components/Worklogs';

type Tab = 'worklogs' | 'tasks' | 'releases';

export default function App() {
  const [creds, setCreds] = useState<Credentials | null>(() => loadCredentials());
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(() => loadCredentials() !== null);
  const [loginError, setLoginError] = useState('');
  const [fatal, setFatal] = useState('');
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('jira-dashboard.tab') as Tab) || 'worklogs');

  const signOut = useCallback((message = '') => {
    clearCredentials();
    setCreds(null);
    setMe(null);
    setChecking(false);
    setLoginError(message);
  }, []);

  // On load, validate whatever token is in storage.
  useEffect(() => {
    if (!creds || me) return;
    const ctrl = new AbortController();
    setChecking(true);
    setFatal('');
    api.me(creds, ctrl.signal).then(
      (m) => {
        setMe(m);
        setChecking(false);
      },
      (e: unknown) => {
        if ((e as Error).name === 'AbortError') return;
        if (e instanceof ApiError && e.status === 401) signOut('Your saved API token was rejected. Please sign in again.');
        else {
          setFatal((e as Error).message);
          setChecking(false);
        }
      },
    );
    return () => ctrl.abort();
  }, [creds, me, signOut]);

  function selectTab(t: Tab) {
    setTab(t);
    try {
      localStorage.setItem('jira-dashboard.tab', t);
    } catch {
      /* storage unavailable: tab just won't be remembered */
    }
  }

  if (!creds) {
    return (
      <Login
        initialError={loginError}
        onLogin={(c, m) => {
          saveCredentials(c);
          setCreds(c);
          setMe(m);
          setLoginError('');
        }}
      />
    );
  }

  if (!me) {
    return (
      <main className="login">
        <div className="card login-card">
          {checking ? (
            <p className="muted">Signing in…</p>
          ) : (
            <>
              <div className="alert" role="alert">{fatal || 'Could not sign in.'}</div>
              <div className="row">
                <button className="btn primary" onClick={() => setCreds({ ...creds })}>Retry</button>
                <button className="btn" onClick={() => signOut()}>Use a different token</button>
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  const unauthorized = () => signOut('Jira rejected your API token. Please sign in again.');
  const initials = me.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Jira Dashboard</div>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'worklogs'} onClick={() => selectTab('worklogs')}>
            Work logs
          </button>
          <button role="tab" aria-selected={tab === 'tasks'} onClick={() => selectTab('tasks')}>
            My tasks
          </button>
          <button role="tab" aria-selected={tab === 'releases'} onClick={() => selectTab('releases')}>
            Releases
          </button>
        </nav>
        <div className="user">
          <span className="avatar" aria-hidden>{initials}</span>
          <div className="user-text">
            <strong>{me.displayName}</strong>
            <span className="muted small">{new URL(creds.site).hostname}</span>
          </div>
          <button className="btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>
      <main className="content">
        {tab === 'worklogs' && <Worklogs creds={creds} onUnauthorized={unauthorized} />}
        {tab === 'tasks' && <Tasks creds={creds} onUnauthorized={unauthorized} />}
        {tab === 'releases' && <Releases creds={creds} onUnauthorized={unauthorized} />}
      </main>
    </div>
  );
}
