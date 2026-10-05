import type { Credentials } from '../shared/types';

const KEY = 'jira-dashboard.credentials';

/** Mirrors the server's normalisation so the stored value is always a clean origin. */
export function normalizeSite(input: string): string {
  let raw = input.trim();
  if (!raw.includes('.') && !raw.includes('/')) raw = `${raw}.atlassian.net`;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  return new URL(raw).origin;
}

/** Returns a clean proxy origin+path without trailing slash, or undefined when blank (same origin). */
export function normalizeProxy(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

export function loadCredentials(): Credentials | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Credentials>;
    return c.site && c.email && c.token ? (c as Credentials) : null;
  } catch {
    return null;
  }
}

export function saveCredentials(c: Credentials) {
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function clearCredentials() {
  localStorage.removeItem(KEY);
}
