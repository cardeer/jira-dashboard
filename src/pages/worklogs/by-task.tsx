import { Fragment, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDay, formatDuration, timeRange } from '@/dates';
import type { TaskGroup } from './aggregate';

export function ByTask({ groups, total, site }: { groups: TaskGroup[]; total: number; site: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(k)) n.add(k);
      return n;
    });

  if (groups.length === 0) return <Card className="p-10 text-center text-sm text-muted-foreground">No work logged in this period.</Card>;

  return (
    <Card className="gap-0 py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Task</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Entries</TableHead>
            <TableHead className="text-right">Time</TableHead>
            <TableHead className="pr-4 text-right">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const isOpen = open.has(g.key);
            const entries = [...g.entries].sort((a, b) => (a.started < b.started ? 1 : -1));
            return (
              <Fragment key={g.key}>
                <TableRow className="cursor-pointer" onClick={() => toggle(g.key)}>
                  <TableCell className="pl-2">
                    <Button variant="ghost" size="icon-xs" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${g.key}`}>
                      {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </Button>
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    <a
                      href={`${site}/browse/${g.key}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mr-1.5 font-medium text-link hover:underline"
                    >
                      {g.key}
                    </a>
                    {g.summary}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{g.projectName}</TableCell>
                  <TableCell className="text-muted-foreground">{g.status}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{g.entries.length}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatDuration(g.seconds)}</TableCell>
                  <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">{Math.round((g.seconds / total) * 100)}%</TableCell>
                </TableRow>
                {isOpen &&
                  entries.map((e) => {
                    const r = timeRange(e.started, e.timeSpentSeconds);
                    return (
                      <TableRow key={e.id} className="bg-muted/40 hover:bg-muted/40">
                        <TableCell />
                        <TableCell colSpan={3} className="whitespace-normal text-sm">
                          <span className="text-muted-foreground">{formatDay(e.date)}</span>{' '}
                          <span className="font-medium tabular-nums">
                            {r.from} – {r.to}
                            {r.nextDay && <sup>+1</sup>}
                          </span>
                          {e.comment && <span className="text-muted-foreground"> — {e.comment}</span>}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums">{formatDuration(e.timeSpentSeconds)}</TableCell>
                        <TableCell />
                      </TableRow>
                    );
                  })}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
