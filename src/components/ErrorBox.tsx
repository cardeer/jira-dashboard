import { useEffect } from 'react';
import type { ApiError } from '../api';

interface Props {
  error: ApiError;
  onRetry: () => void;
  onUnauthorized: () => void;
}

export default function ErrorBox({ error, onRetry, onUnauthorized }: Props) {
  // A rejected token means the stored credentials are stale: go back to the login screen.
  useEffect(() => {
    if (error.status === 401) onUnauthorized();
  }, [error, onUnauthorized]);

  return (
    <div className="alert" role="alert">
      <span>{error.message}</span>
      <button className="btn" onClick={onRetry}>Retry</button>
    </div>
  );
}
