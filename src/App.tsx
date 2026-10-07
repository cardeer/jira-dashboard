import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Loader2Icon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/app-shell';
import { api, ApiError } from '@/api';
import { clearCredentials, loadCredentials, saveCredentials } from '@/auth';
import { SessionContext, type Session } from '@/lib/session';
import { LoginPage } from '@/pages/login';

// Route-level code splitting keeps the first load small (charts, calendar etc. load on demand).
const WorklogsPage = lazy(() => import('@/pages/worklogs').then((m) => ({ default: m.WorklogsPage })));
const TasksPage = lazy(() => import('@/pages/tasks/index').then((m) => ({ default: m.TasksPage })));
const ReleasesPage = lazy(() => import('@/pages/releases').then((m) => ({ default: m.ReleasesPage })));
const ReleaseDetailPage = lazy(() => import('@/pages/release-detail').then((m) => ({ default: m.ReleaseDetailPage })));
const PlanLobbyPage = lazy(() => import('@/pages/plan/index').then((m) => ({ default: m.PlanLobbyPage })));
const PlanRoomPage = lazy(() => import('@/pages/plan/room').then((m) => ({ default: m.PlanRoomPage })));
import type { Credentials, Me } from '../shared/types';

export default function App() {
  // Planning poker is public: it talks to peers directly and never touches Jira.
  const { pathname } = useLocation();
  if (pathname === '/plan' || pathname.startsWith('/plan/')) {
    return (
      <Suspense
        fallback={
          <main className="grid min-h-svh place-items-center">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </main>
        }
      >
        <Routes>
          <Route path="plan" element={<PlanLobbyPage />} />
          <Route path="plan/:roomId" element={<PlanRoomPage />} />
          <Route path="*" element={<Navigate to="/plan" replace />} />
        </Routes>
      </Suspense>
    );
  }
  return <AuthedApp />;
}

function AuthedApp() {
  const [creds, setCreds] = useState<Credentials | null>(() => loadCredentials());
  const [me, setMe] = useState<Me | null>(null);
  const [loginError, setLoginError] = useState('');
  const [fatal, setFatal] = useState('');
  const [attempt, setAttempt] = useState(0);

  const signOut = useCallback((message = '') => {
    clearCredentials();
    setCreds(null);
    setMe(null);
    setLoginError(message);
  }, []);

  // Validate whatever token is in storage before showing any page.
  useEffect(() => {
    if (!creds || me) return;
    const ctrl = new AbortController();
    setFatal('');
    api.me(creds, ctrl.signal).then(setMe, (e: unknown) => {
      if ((e as Error).name === 'AbortError') return;
      if (e instanceof ApiError && e.status === 401) signOut('Your saved API token was rejected. Please sign in again.');
      else setFatal((e as Error).message);
    });
    return () => ctrl.abort();
  }, [creds, me, signOut, attempt]);

  const session = useMemo<Session | null>(
    () =>
      creds && me
        ? { creds, me, signOut, onUnauthorized: () => signOut('Jira rejected your API token. Please sign in again.') }
        : null,
    [creds, me, signOut],
  );

  if (!creds) {
    // Stay on the current URL: after signing in, the requested page (deep link) renders.
    return (
      <LoginPage
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

  if (!session) {
    return (
      <main className="grid min-h-svh place-items-center p-4">
        {fatal ? (
          <Alert variant="destructive" className="max-w-md">
            <AlertTitle>Couldn’t sign in</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>{fatal}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>Retry</Button>
                <Button size="sm" variant="outline" onClick={() => signOut()}>Use a different token</Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Signing in…
          </p>
        )}
      </main>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/worklogs" replace />} />
          <Route path="worklogs" element={<WorklogsPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="releases" element={<ReleasesPage />} />
          <Route path="releases/:projectKey/:versionId" element={<ReleaseDetailPage />} />
          <Route path="*" element={<Navigate to="/worklogs" replace />} />
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}
