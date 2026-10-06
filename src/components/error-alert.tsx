import { useEffect } from 'react';
import { AlertCircleIcon, RotateCwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ApiError } from '@/api';
import { useSession } from '@/lib/session';

export function ErrorAlert({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { onUnauthorized } = useSession();

  // A rejected token means the stored credentials are stale: go back to sign-in.
  useEffect(() => {
    if (error.status === 401) onUnauthorized();
  }, [error, onUnauthorized]);

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircleIcon />
      <AlertTitle>Couldn’t load from Jira</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{error.message}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCwIcon data-icon="inline-start" /> Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
