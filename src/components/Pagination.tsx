import { useEffect, useMemo, useState } from 'react';

const SIZES = [10, 25, 50, 100];

/** Client-side paging; jumps back to page 1 whenever the item list (or page size) changes. */
export function usePagination<T>(items: T[], initialSize = 25) {
  const [size, setSize] = useState(initialSize);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);

  useEffect(() => setPage(1), [items, size]);

  const slice = useMemo(() => items.slice((current - 1) * size, current * size), [items, current, size]);
  return { slice, page: current, pages, size, setPage, setSize, total: items.length };
}

/** 1 … 4 5 [6] 7 8 … 20 */
function pageList(current: number, pages: number): (number | '…')[] {
  const keep = new Set([1, pages, current - 1, current, current + 1]);
  const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

type Pager = ReturnType<typeof usePagination>;

export default function Pagination({ page, pages, size, total, setPage, setSize }: Omit<Pager, 'slice'>) {
  if (total === 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  return (
    <div className="pager">
      <span className="muted small">
        {from}–{to} of {total}
      </span>
      <label className="pager-size small muted">
        Rows
        <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page">
          {SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <nav className="pager-pages" aria-label="Pagination">
        <button className="btn" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
          ‹
        </button>
        {pageList(page, pages).map((n, i) =>
          n === '…' ? (
            <span key={`gap${i}`} className="muted">…</span>
          ) : (
            <button
              key={n}
              className={`btn ${n === page ? 'primary' : ''}`}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ),
        )}
        <button className="btn" disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="Next page">
          ›
        </button>
      </nav>
    </div>
  );
}
