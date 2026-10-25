import { useMemo, useState } from 'react';
import { AlertCircleIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PageHeader } from '@/components/page-header';
import { eachDay, formatDay, toISO } from '@/dates';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useSearchState } from '@/lib/use-search-state';
import { sheets, sheetsConfigured } from '@/sheets';
import { useAsync } from '@/useAsync';
import { HolidayDialog } from './holiday-dialog';
import { LeaveDialog, LEAVE_TYPES } from './leave-dialog';
import type { Holiday, Leave } from '../../../shared/types';

type Range = 'upcoming' | 'all';

export const dateSpan = (from: string, to: string) =>
  from === to
    ? formatDay(from, { year: 'numeric' })
    : `${formatDay(from)} – ${formatDay(to, { year: 'numeric' })}`;

const dayCount = (from: string, to: string) => {
  const n = eachDay(from, to).length;
  return n === 1 ? '1 day' : `${n} days`;
};

export function TimeOffPage() {
  useDocumentTitle('Time off');
  const { get, set } = useSearchState();
  const tab = get('tab') === 'leaves' ? 'leaves' : 'holidays';
  const range: Range = get('range') === 'all' ? 'all' : 'upcoming';
  const { data, loading, error, reload } = useAsync(
    (s) => (sheetsConfigured ? sheets.list(s) : Promise.resolve(null)),
    [],
  );
  const [holiday, setHoliday] = useState<Holiday | 'new' | null>(null);
  const [leave, setLeave] = useState<Leave | 'new' | null>(null);

  const today = toISO(new Date());
  const visible = <T extends { start_date: string; end_date: string }>(rows: T[] = []) =>
    rows
      .filter((r) => range === 'all' || r.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const holidays = useMemo(() => visible(data?.holidays), [data, range, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const leaves = useMemo(() => visible(data?.leaves), [data, range, today]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sheetsConfigured) {
    return (
      <>
        <PageHeader title="Time off" />
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Google Sheet not connected</AlertTitle>
          <AlertDescription>
            Set <code>VITE_SHEETS_URL</code> and <code>VITE_SHEETS_KEY</code> (see <code>.env.example</code> and{' '}
            <code>scripts/sheets-api.gs</code>), then restart the dev server.
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const empty = (what: string) => (
    <TableRow>
      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
        {range === 'upcoming' ? `No upcoming ${what}.` : `No ${what} yet.`}
      </TableCell>
    </TableRow>
  );
  const skeleton = Array.from({ length: 3 }, (_, i) => (
    <TableRow key={i}>
      <TableCell colSpan={5}>
        <Skeleton className="h-5 w-full" />
      </TableCell>
    </TableRow>
  ));

  return (
    <>
      <PageHeader
        title="Time off"
        description="Company holidays and people’s leaves, stored in Google Sheets."
        actions={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={range}
              onValueChange={(v) => v && set({ range: v === 'all' ? null : v })}
            >
              <ToggleGroupItem value="upcoming">Upcoming</ToggleGroupItem>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCwIcon data-icon="inline-start" className={loading ? 'animate-spin' : undefined} /> Refresh
            </Button>
            <Button size="sm" onClick={() => (tab === 'holidays' ? setHoliday('new') : setLeave('new'))}>
              <PlusIcon data-icon="inline-start" /> {tab === 'holidays' ? 'Add holiday' : 'Add leave'}
            </Button>
          </>
        }
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircleIcon />
          <AlertTitle>Couldn’t load from Google Sheets</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error.message}</span>
            <Button size="sm" variant="outline" onClick={reload}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'leaves' ? v : null })}>
        <TabsList>
          <TabsTrigger value="holidays">Holidays</TabsTrigger>
          <TabsTrigger value="leaves">Leaves</TabsTrigger>
        </TabsList>

        <TabsContent value="holidays">
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Holiday</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !data
                  ? skeleton
                  : holidays.length === 0
                    ? empty('holidays')
                    : holidays.map((h) => (
                        <TableRow key={h.id} className="cursor-pointer" onClick={() => setHoliday(h)}>
                          <TableCell className="whitespace-nowrap tabular-nums">{dateSpan(h.start_date, h.end_date)}</TableCell>
                          <TableCell className="font-medium">{h.name}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{dayCount(h.start_date, h.end_date)}</TableCell>
                          <TableCell className="max-w-80 truncate text-muted-foreground">{h.note}</TableCell>
                        </TableRow>
                      ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="leaves">
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !data
                  ? skeleton
                  : leaves.length === 0
                    ? empty('leaves')
                    : leaves.map((l) => (
                        <TableRow key={l.id} className="cursor-pointer" onClick={() => setLeave(l)}>
                          <TableCell className="font-medium">{l.name}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{dateSpan(l.start_date, l.end_date)}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                            {l.start_time && l.end_time ? `${l.start_time} – ${l.end_time}` : dayCount(l.start_date, l.end_date)}
                          </TableCell>
                          <TableCell>
                            {l.type && (
                              <Badge variant="secondary">{LEAVE_TYPES.find((t) => t.id === l.type)?.label ?? l.type}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-80 truncate text-muted-foreground">{l.note}</TableCell>
                        </TableRow>
                      ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <HolidayDialog
        open={holiday !== null}
        onOpenChange={(o) => !o && setHoliday(null)}
        holiday={holiday === 'new' ? null : holiday}
        onSaved={reload}
      />
      <LeaveDialog
        open={leave !== null}
        onOpenChange={(o) => !o && setLeave(null)}
        leave={leave === 'new' ? null : leave}
        onSaved={reload}
      />
    </>
  );
}
