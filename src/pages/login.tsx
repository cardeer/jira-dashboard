import { useState, type FormEvent } from 'react';
import { AlertCircleIcon, ExternalLinkIcon, LayoutDashboardIcon, Loader2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/api';
import { normalizeSite } from '@/auth';
import type { Credentials, Me } from '../../shared/types';

interface Props {
  initialError?: string;
  onLogin: (creds: Credentials, me: Me) => void;
}

export function LoginPage({ initialError, onLogin }: Props) {
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
      setError('Enter your Jira Cloud address, like yourcompany.atlassian.net.');
      return;
    }
    setBusy(true);
    try {
      onLogin(creds, await api.me(creds));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={submit} className="contents">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LayoutDashboardIcon className="size-5" />
            </div>
            <CardTitle className="text-xl">Jira Dashboard</CardTitle>
            <CardDescription>Sign in with your Atlassian API token to see your tasks, work logs and releases.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="site">Jira site</Label>
              <Input id="site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourcompany.atlassian.net" autoComplete="url" required autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Atlassian email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="username" required />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="token">API token</Label>
                <a
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  href="https://id.atlassian.com/manage-profile/security/api-tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  Create a token <ExternalLinkIcon className="size-3" />
                </a>
              </div>
              <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" required />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Your token is saved in this browser’s local storage and sent only to your Jira site. Sign out to remove it.
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
