import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export function PageHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small label next to the title, e.g. an active filter. */
  badge?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {badge && <Badge variant="secondary">{badge}</Badge>}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
