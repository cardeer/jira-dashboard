import { useEffect, useRef } from 'react';

const APP = 'Jira Dashboard';

/** Active titles; the highest priority (then the most recent) one is shown. */
const entries: { title: string | null; priority: number; order: number }[] = [];
let counter = 0;

function apply() {
  const top = entries
    .filter((e) => e.title)
    .sort((a, b) => b.priority - a.priority || b.order - a.order)[0];
  document.title = top ? `${top.title} · ${APP}` : APP;
}

/**
 * Sets the browser tab title while the component is mounted. Panels opened over a page (e.g. the
 * task details sheet) pass a higher `priority` so they win over the page; closing them restores it.
 */
export function useDocumentTitle(title: string | null | undefined, priority = 0) {
  const entry = useRef<(typeof entries)[number] | null>(null);

  useEffect(() => {
    const e = { title: null, priority, order: counter++ };
    entry.current = e;
    entries.push(e);
    return () => {
      entries.splice(entries.indexOf(e), 1);
      entry.current = null;
      apply();
    };
  }, [priority]);

  useEffect(() => {
    if (!entry.current) return;
    entry.current.title = title || null;
    apply();
  }, [title, priority]);
}
