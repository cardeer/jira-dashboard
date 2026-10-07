import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

/** Runs `fn` whenever `deps` change, aborting the previous request. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(ctrl.signal).then(
      (data) => setState({ data, loading: false, error: null }),
      (e: unknown) => {
        // Only our own cancellation is expected; anything else (even an AbortError from a shared
        // request someone else cancelled) must surface instead of leaving the UI loading forever.
        if ((e as Error).name === 'AbortError' && ctrl.signal.aborted) return;
        setState({ data: null, loading: false, error: e instanceof ApiError ? e : new ApiError(0, String(e)) });
      },
    );
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
