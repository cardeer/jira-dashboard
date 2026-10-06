import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

type Patch = Record<string, string | number | null | undefined>;

/**
 * Page state kept in the URL query string, so Back/Forward, refresh and shared links restore it.
 * `set` pushes a history entry by default; pass `{ replace: true }` for high-frequency updates
 * (e.g. search typing). null/'' removes the key, keeping URLs short when values are defaults.
 */
export function useSearchState() {
  const [params, setParams] = useSearchParams();

  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);

  const set = useCallback(
    (patch: Patch, opts: { replace?: boolean } = {}) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      // No-op updates must not add a history entry (Back would appear to do nothing).
      if (next.toString() === params.toString()) return;
      setParams(next, { replace: opts.replace });
    },
    [params, setParams],
  );

  return { params, get, set };
}

/**
 * A text input mirrored into the `key` query param after the user pauses typing.
 * Uses history replace so each keystroke doesn't add a Back step. `onCommit` lets callers reset
 * dependent state (e.g. page) in the same URL update.
 */
export function useUrlSearchInput(key: string, extraPatch: Patch = {}, ms = 350) {
  const { get, set } = useSearchState();
  const urlValue = get(key);
  const [value, setValue] = useState(urlValue);

  // URL changed elsewhere (Back/Forward): reflect it in the input.
  useEffect(() => setValue(urlValue), [urlValue]);

  useEffect(() => {
    if (value === urlValue) return;
    const t = setTimeout(() => set({ [key]: value.trim() || null, ...extraPatch }, { replace: true }), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return [value, setValue] as const;
}
