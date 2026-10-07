import { useMemo, useState, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { toast } from 'sonner';
import type { JSONContent } from '@tiptap/react';
import { CalendarIcon, ExternalLinkIcon, Loader2Icon, PencilIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { AssigneePicker, type Assignee } from '@/components/assignee-picker';
import { DurationInput } from '@/components/duration-input';
import { ErrorAlert } from '@/components/error-alert';
import { PersonAvatar } from '@/components/person-avatar';
import { RichTextEditor } from '@/components/rich-text-editor';
import { StatusMenu } from '@/components/status-menu';
import { api, ApiError, type EditMeta, type IssueDetail } from '@/api';
import { formatDate, formatDuration, fromISO, relativeTime, toISO } from '@/dates';
import { adfIsEditable, adfToTiptap, tiptapToAdf } from '@/lib/adf';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useAsync } from '@/useAsync';

interface Props {
  /** Issue to show; null closes the sheet. */
  issueKey: string | null;
  onClose: () => void;
  /** Called after any successful change so lists can refresh. */
  onChanged?: (key: string) => void;
}

/** Side panel with an issue's details; fields Jira lets you edit can be changed in place. */
export function TaskDetailsSheet({ issueKey, onClose, onChanged }: Props) {
  return (
    <Sheet open={issueKey !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
        {issueKey && <Details key={issueKey} issueKey={issueKey} onChanged={onChanged} />}
      </SheetContent>
    </Sheet>
  );
}

function Details({ issueKey, onChanged }: { issueKey: string; onChanged?: (key: string) => void }) {
  const { creds, me, onUnauthorized } = useSession();
  const detail = useAsync((s) => api.issueDetail(creds, issueKey, s), [creds, issueKey]);
  const meta = useAsync((s) => api.editMeta(creds, issueKey, s), [creds, issueKey]);
  const d = detail.data;
  const can = (field: string) => Boolean(meta.data?.editable.has(field));

  /** Save some fields, then refresh the panel and the list behind it. */
  async function save(fields: Record<string, unknown>, what: string) {
    try {
      await api.updateIssue(creds, issueKey, fields);
      toast.success(`${issueKey}: ${what} updated`);
      detail.reload();
      onChanged?.(issueKey);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      toast.error(`Couldn’t update ${what}`, { description: (e as Error).message });
      return false;
    }
  }

  if (detail.error) {
    return (
      <div className="p-6">
        <SheetHeader className="p-0 pb-4">
          <SheetTitle>{issueKey}</SheetTitle>
        </SheetHeader>
        <ErrorAlert error={detail.error} onRetry={detail.reload} />
      </div>
    );
  }
  if (!d) {
    return (
      <div className="grid gap-4 p-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const jiraUrl = `${creds.site}/browse/${d.key}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="gap-2 border-b p-5 pr-12">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {d.issueType.iconUrl && <img src={d.issueType.iconUrl} alt="" className="size-4" />}
          {d.parent && (
            <>
              <a href={`${creds.site}/browse/${d.parent.key}`} target="_blank" rel="noreferrer" className="hover:underline" title={d.parent.summary}>
                {d.parent.key}
              </a>
              <span>/</span>
            </>
          )}
          <a href={jiraUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-link hover:underline">
            {d.key} <ExternalLinkIcon className="size-3" />
          </a>
          <span>· {d.project.name}</span>
        </div>
        <SheetTitle className="sr-only">{d.summary}</SheetTitle>
        <SheetDescription className="sr-only">Details of {d.key}</SheetDescription>
        <EditableSummary value={d.summary} editable={can('summary')} onSave={(v) => save({ summary: v }, 'summary')} />
        <div>
          <StatusMenu
            issueKey={d.key}
            status={d.status}
            category={d.statusCategory}
            onChanged={() => {
              detail.reload();
              onChanged?.(d.key);
            }}
          />
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-[9rem_1fr]">
          <Field label="Assignee">
            {can('assignee') ? (
              <AssigneePicker
                projectKey={d.project.key}
                value={toAssignee(d, me.accountId)}
                onChange={(a) =>
                  save({ assignee: a.kind === 'none' ? null : { accountId: a.kind === 'me' ? me.accountId : a.person.accountId } }, 'assignee')
                }
              />
            ) : (
              <PersonLine person={d.assignee} empty="Unassigned" />
            )}
          </Field>
          <Field label="Reporter">
            <PersonLine person={d.reporter} empty="—" />
          </Field>
          <Field label="Priority">
            <PriorityField detail={d} meta={meta.data} onSave={(id, name) => save({ priority: { id } }, `priority (${name})`)} />
          </Field>
          <Field label="Original estimate">
            <EstimateField
              seconds={d.timetracking.originalEstimateSeconds}
              editable={can('timetracking')}
              onSave={(min) => save({ timetracking: { originalEstimate: `${min}m` } }, 'original estimate')}
            />
          </Field>
          <Field label="Remaining">
            <EstimateField
              seconds={d.timetracking.remainingEstimateSeconds}
              editable={can('timetracking')}
              onSave={(min) => save({ timetracking: { remainingEstimate: `${min}m` } }, 'remaining estimate')}
            />
          </Field>
          <Field label="Time spent">
            <span className="tabular-nums">{d.timetracking.timeSpent ?? '—'}</span>
          </Field>
          {d.fieldIds.storyPoints && (
            <Field label="Story points">
              <StoryPointsField
                value={d.storyPoints}
                editable={can(d.fieldIds.storyPoints)}
                onSave={(v) => save({ [d.fieldIds.storyPoints!]: v }, 'story points')}
              />
            </Field>
          )}
          <Field label="Due date">
            <DueDateField value={d.dueDate} editable={can('duedate')} onSave={(v) => save({ duedate: v }, 'due date')} />
          </Field>
          <Field label="Labels">
            <LabelsField value={d.labels} editable={can('labels')} onSave={(v) => save({ labels: v }, 'labels')} />
          </Field>
          <Field label="Sprint">
            {d.sprints.length ? (
              <div className="flex flex-wrap gap-1.5">
                {d.sprints.map((s) => (
                  <Badge key={s.id} variant={s.state === 'active' ? 'default' : 'secondary'}>
                    {s.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Fix versions">
            {d.fixVersions.length ? (
              <div className="flex flex-wrap gap-1.5">
                {d.fixVersions.map((v) => (
                  <Badge key={v.id} variant="secondary">{v.name}</Badge>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Created">
            <span className="text-muted-foreground">{relativeTime(d.created)}</span>
          </Field>
          <Field label="Updated">
            <span className="text-muted-foreground">{relativeTime(d.updated)}</span>
          </Field>
        </div>

        <Separator />

        <DescriptionSection
          detail={d}
          editable={can('description')}
          site={creds.site}
          onSave={(doc) => save({ description: tiptapToAdf(doc) }, 'description')}
        />
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="pt-1.5 text-sm text-muted-foreground">{label}</div>
      <div className="flex min-h-8 min-w-0 items-center text-sm">{children}</div>
    </>
  );
}

function PersonLine({ person, empty }: { person: IssueDetail['assignee']; empty: string }) {
  if (!person) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar person={person} />
      <span className="truncate">{person.displayName}</span>
    </span>
  );
}

function toAssignee(d: IssueDetail, myId: string): Assignee {
  if (!d.assignee) return { kind: 'none' };
  return d.assignee.accountId === myId ? { kind: 'me' } : { kind: 'user', person: d.assignee };
}

function EditableSummary({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  async function commit() {
    const v = draft.trim();
    if (!v || v === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    setBusy(true);
    if (await onSave(v)) setEditing(false);
    setBusy(false);
  }

  if (!editing) {
    return (
      <h2
        className={cn('text-xl leading-snug font-semibold', editable && '-mx-1.5 cursor-text rounded-md px-1.5 hover:bg-accent')}
        onClick={() => editable && (setDraft(value), setEditing(true))}
        title={editable ? 'Click to edit' : undefined}
      >
        {value}
      </h2>
    );
  }
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      disabled={busy}
      autoFocus
      className="h-9 text-lg font-semibold"
    />
  );
}

function PriorityField({
  detail,
  meta,
  onSave,
}: {
  detail: IssueDetail;
  meta: EditMeta | null;
  onSave: (id: string, name: string) => void;
}) {
  const options = meta?.priorities ?? [];
  if (!meta?.editable.has('priority') || options.length === 0) {
    return detail.priority ? (
      <span className="flex items-center gap-2">
        {detail.priority.iconUrl && <img src={detail.priority.iconUrl} alt="" className="size-4" />}
        {detail.priority.name}
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }
  return (
    <Select
      value={detail.priority?.id ?? ''}
      onValueChange={(id) => onSave(id, options.find((o) => o.id === id)?.name ?? '')}
    >
      <SelectTrigger size="sm" className="w-44" aria-label="Priority">
        <SelectValue placeholder="None" />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.iconUrl && <img src={p.iconUrl} alt="" className="size-4" />}
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EstimateField({ seconds, editable, onSave }: { seconds?: number; editable: boolean; onSave: (minutes: number) => void }) {
  const minutes = Math.round((seconds ?? 0) / 60);
  if (!editable) return <span className="tabular-nums">{minutes ? formatDuration(minutes * 60) : '—'}</span>;
  return <DurationInput value={minutes} onChange={(m) => m !== minutes && onSave(m)} className="h-8 w-32" />;
}

function StoryPointsField({ value, editable, onSave }: { value: number | null; editable: boolean; onSave: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  if (!editable) return <span className="tabular-nums">{value ?? '—'}</span>;
  const commit = () => {
    const v = draft.trim() === '' ? null : Number(draft);
    if (v !== null && Number.isNaN(v)) return setDraft(value === null ? '' : String(value));
    if (v !== value) onSave(v);
  };
  return (
    <Input
      type="number"
      min={0}
      step="any"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="h-8 w-24 tabular-nums"
      aria-label="Story points"
    />
  );
}

function DueDateField({ value, editable, onSave }: { value: string | null; editable: boolean; onSave: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const label = value ? formatDate(value) : 'None';
  if (!editable) return <span className={cn(!value && 'text-muted-foreground')}>{value ? label : '—'}</span>;
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn('font-normal', !value && 'text-muted-foreground')}>
            <CalendarIcon data-icon="inline-start" /> {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            weekStartsOn={1}
            selected={value ? fromISO(value) : undefined}
            defaultMonth={value ? fromISO(value) : undefined}
            onSelect={(d) => {
              setOpen(false);
              if (d) onSave(toISO(d));
            }}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon-sm" onClick={() => onSave(null)} aria-label="Clear due date">
          <XIcon />
        </Button>
      )}
    </div>
  );
}

function LabelsField({ value, editable, onSave }: { value: string[]; editable: boolean; onSave: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  if (!editable && value.length === 0) return <span className="text-muted-foreground">—</span>;
  const add = () => {
    // Jira labels can't contain spaces.
    const l = draft.trim().replace(/\s+/g, '-');
    setDraft('');
    if (l && !value.includes(l)) onSave([...value, l]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((l) => (
        <Badge key={l} variant="secondary" className="gap-1 pr-1">
          {l}
          {editable && (
            <button type="button" onClick={() => onSave(value.filter((x) => x !== l))} aria-label={`Remove label ${l}`} className="rounded-full hover:bg-foreground/10">
              <XIcon className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {editable && (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Add label"
          className="h-7 w-28"
        />
      )}
    </div>
  );
}

/** Sanitise Jira's rendered HTML and make links/images point at the Jira site. */
function cleanHtml(html: string, site: string): string {
  const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  const doc = new DOMParser().parseFromString(safe, 'text/html');
  doc.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href?.startsWith('/')) a.setAttribute('href', site + href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer');
  });
  // Attachment images need Jira's login, which this page doesn't have: link to them instead.
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith('/') || src.includes('/attachment/')) {
      const a = doc.createElement('a');
      a.href = src.startsWith('/') ? site + src : src;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = `🖼 ${img.getAttribute('alt') || 'image'} (open in Jira)`;
      img.replaceWith(a);
    }
  });
  return doc.body.innerHTML;
}

function DescriptionSection({
  detail,
  editable,
  site,
  onSave,
}: {
  detail: IssueDetail;
  editable: boolean;
  site: string;
  onSave: (doc: JSONContent) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<JSONContent | null>(null);
  const [busy, setBusy] = useState(false);
  const html = useMemo(() => cleanHtml(detail.descriptionHtml, site), [detail.descriptionHtml, site]);
  // Editing content the editor can't represent (images, tables, mentions…) would drop it.
  const safeToEdit = adfIsEditable(detail.description);
  const initial = useMemo(() => adfToTiptap(detail.description), [detail.description]);

  return (
    <section className="p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Description</h3>
        {editable && !editing && safeToEdit && (
          <Button variant="ghost" size="sm" onClick={() => (setDraft(initial), setEditing(true))}>
            <PencilIcon data-icon="inline-start" /> Edit
          </Button>
        )}
        {editable && !safeToEdit && (
          <Button variant="ghost" size="sm" asChild>
            <a href={`${site}/browse/${detail.key}`} target="_blank" rel="noreferrer" title="Contains images, tables or other content this editor can't change safely">
              Edit in Jira <ExternalLinkIcon data-icon="inline-end" />
            </a>
          </Button>
        )}
      </div>
      {editing ? (
        <div className="grid gap-2">
          <RichTextEditor content={initial} onChange={setDraft} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                if (await onSave(draft ?? initial)) setEditing(false);
                setBusy(false);
              }}
            >
              {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Save
            </Button>
          </div>
        </div>
      ) : html ? (
        <div className="jira-prose text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-sm text-muted-foreground">{editable ? 'No description yet. Click Edit to add one.' : 'No description.'}</p>
      )}
    </section>
  );
}
