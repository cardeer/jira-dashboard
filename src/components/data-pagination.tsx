import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const PAGE_SIZES = [10, 25, 50, 100];

/** 1 … 4 5 [6] 7 8 … 20 */
function pageList(current: number, pages: number): (number | 'gap')[] {
  const keep = [1, pages, current - 1, current, current + 1].filter((n) => n >= 1 && n <= pages);
  const nums = [...new Set(keep)].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('gap');
    out.push(n);
  });
  return out;
}

interface Props {
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}

export function DataPagination({ page, size, total, onPage, onSize }: Props) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);
  const from = (current - 1) * size + 1;
  const to = Math.min(current * size, total);

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      <span className="text-sm text-muted-foreground tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Rows
        <Select value={String(size)} onValueChange={(v) => onSize(Number(v))}>
          <SelectTrigger size="sm" className="w-18" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((s) => (
              <SelectItem key={s} value={String(s)}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <Button variant="ghost" size="icon" disabled={current === 1} onClick={() => onPage(current - 1)} aria-label="Previous page">
              <ChevronLeftIcon />
            </Button>
          </PaginationItem>
          {pageList(current, pages).map((n, i) =>
            n === 'gap' ? (
              <PaginationItem key={`gap${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={n}>
                <Button
                  variant={n === current ? 'outline' : 'ghost'}
                  size="icon"
                  aria-current={n === current ? 'page' : undefined}
                  onClick={() => onPage(n)}
                  className="tabular-nums"
                >
                  {n}
                </Button>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <Button variant="ghost" size="icon" disabled={current === pages} onClick={() => onPage(current + 1)} aria-label="Next page">
              <ChevronRightIcon />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
