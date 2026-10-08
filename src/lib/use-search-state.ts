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

const readSaved = (storageKey: string): Record<string, string> => {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

/**
 * Remembers the given query params in localStorage and restores them when the page is opened
 * without any of them (e.g. from the sidebar). Returns false while the restore redirect is pending,
 * so the page can skip rendering (and fetching) with default filters first.
 */
export function useRememberedSearch(storageKey: string, keys: readonly string[]) {
  const [params, setParams] = useSearchParams();
  const hasAny = keys.some((k) => params.has(k));
  // What to restore, read once per visit; only applied when the URL has none of the keys.
  const [saved] = useState(() =>
    Object.entries(readSaved(storageKey)).filter(([k, v]) => keys.includes(k) && typeof v === 'string' && v),
  );
  const [done, setDone] = useState(false);
  // Wait until the restored params are actually in the URL (router updates land asynchronously).
  const pending = !done && !hasAny && saved.length > 0;

  useEffect(() => {
    if (!pending) {
      setDone(true);
      return;
    }
    const next = new URLSearchParams(params);
    for (const [k, v] of saved) next.set(k, v);
    setParams(next, { replace: true });
  }, [pending, params, saved, setParams]);

  const snapshot = JSON.stringify(Object.fromEntries(keys.flatMap((k) => (params.has(k) ? [[k, params.get(k)!]] : []))));
  useEffect(() => {
    if (pending) return;
    try {
      localStorage.setItem(storageKey, snapshot);
    } catch {
      /* storage unavailable: filters just won't be remembered */
    }
  }, [pending, storageKey, snapshot]);

  return !pending;
}
