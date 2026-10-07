import { useEffect, useMemo, useState, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { toast } from 'sonner';
import type { JSONContent } from '@tiptap/react';
import { CalendarIcon, ExternalLinkIcon, Loader2Icon, PencilIcon, XIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { api, ApiError, type EditMeta, type IssueDetail, type Transition } from '@/api';
import type { Person } from '../../shared/types';
import { formatDate, formatDuration, fromISO, relativeTime, toISO } from '@/dates';
import { adfHasOpaqueContent, adfToTiptap, tiptapToAdf } from '@/lib/adf';
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

/**
 * Side panel with an issue's details. Edits collect in a draft and are only sent to Jira when
 * you press Save (Discard throws them away); closing with unsaved changes asks first.
 */
export function TaskDetailsSheet({ issueKey, onClose, onChanged }: Props) {
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  return (
    <>
      <Sheet
        open={issueKey !== null}
        onOpenChange={(o) => {
          if (o) return;
          if (dirty) setConfirmClose(true);
          else onClose();
        }}
      >
        <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
          {issueKey && <Details key={issueKey} issueKey={issueKey} onChanged={onChanged} onDirtyChange={setDirty} />}
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your edits to {issueKey} haven’t been saved to Jira.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDirty(false);
                onClose();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Pending edits. A key is present only while its value differs from what Jira has. */
interface Draft {
  summary?: string;
  assignee?: Assignee;
  priority?: { id: string; name: string };
  original?: number; // minutes
  remaining?: number; // minutes
  storyPoints?: number | null;
  testers?: Person[];
  dueDate?: string | null;
  labels?: string[];
  description?: JSONContent;
  transition?: Transition;
}
const LABELS: Record<keyof Draft, string> = {
  summary: 'summary',
  assignee: 'assignee',
  priority: 'priority',
  original: 'original estimate',
  remaining: 'remaining estimate',
  storyPoints: 'story points',
  testers: 'tester',
  dueDate: 'due date',
  labels: 'labels',
  description: 'description',
  transition: 'status',
};

const samePeople = (a: Person[], b: Person[]) => a.map((p) => p.accountId).join() === b.map((p) => p.accountId).join();

const sameAssignee = (a: Assignee, b: Assignee, myId: string) => {
  const id = (x: Assignee) => (x.kind === 'none' ? null : x.kind === 'me' ? myId : x.person.accountId);
  return id(a) === id(b);
};
/** Comparable form of a description (normalised through the editor's ADF subset). */
const docKey = (doc: JSONContent | null) => JSON.stringify(doc ? tiptapToAdf(doc) : null);

function Details({
  issueKey,
  onChanged,
  onDirtyChange,
}: {
  issueKey: string;
  onChanged?: (key: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { creds, me, onUnauthorized } = useSession();
  const detail = useAsync((s) => api.issueDetail(creds, issueKey, s), [creds, issueKey]);
  const meta = useAsync((s) => api.editMeta(creds, issueKey, s), [creds, issueKey]);
  const d = detail.data;
  const can = (field: string) => Boolean(meta.data?.editable.has(field));

  // The editor's starting document: build it once per loaded description, not on every render.
  const initialDescription = useMemo(() => adfToTiptap(detail.data?.description ?? null), [detail.data?.description]);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const changed = Object.keys(draft) as (keyof Draft)[];
  useEffect(() => onDirtyChange(changed.length > 0), [changed.length, onDirtyChange]);

  /** Stage a change; setting a field back to Jira's value un-stages it. */
  function stage<K extends keyof Draft>(key: K, value: Draft[K] | undefined, isOriginal: boolean) {
    setDraft((prev) => {
      const next = { ...prev };
      if (isOriginal || value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
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

  const original = {
    assignee: toAssignee(d, me.accountId),
    estimate: Math.round((d.timetracking.originalEstimateSeconds ?? 0) / 60),
    remaining: Math.round((d.timetracking.remainingEstimateSeconds ?? 0) / 60),
    description: initialDescription,
  };
  const v = {
    summary: draft.summary ?? d.summary,
    assignee: draft.assignee ?? original.assignee,
    priorityId: draft.priority?.id ?? d.priority?.id ?? '',
    estimate: draft.original ?? original.estimate,
    remaining: draft.remaining ?? original.remaining,
    storyPoints: 'storyPoints' in draft ? (draft.storyPoints ?? null) : d.storyPoints,
    testers: draft.testers ?? d.testers,
    dueDate: 'dueDate' in draft ? (draft.dueDate ?? null) : d.dueDate,
    labels: draft.labels ?? d.labels,
  };

  function discard() {
    setDraft({});
    setEditingDescription(false);
  }

  async function save() {
    if (!d || saving || changed.length === 0) return;
    const fields: Record<string, unknown> = {};
    if ('summary' in draft) fields.summary = draft.summary;
    if (draft.assignee) {
      const a = draft.assignee;
      fields.assignee = a.kind === 'none' ? null : { accountId: a.kind === 'me' ? me.accountId : a.person.accountId };
    }
    if (draft.priority) fields.priority = { id: draft.priority.id };
    if ('original' in draft || 'remaining' in draft) {
      fields.timetracking = {
        ...('original' in draft ? { originalEstimate: `${draft.original}m` } : {}),
        ...('remaining' in draft ? { remainingEstimate: `${draft.remaining}m` } : {}),
      };
    }
    if ('storyPoints' in draft && d.fieldIds.storyPoints) fields[d.fieldIds.storyPoints] = draft.storyPoints;
    if (draft.testers && d.fieldIds.tester) {
      const ref = (p: Person) => ({ accountId: p.accountId });
      fields[d.fieldIds.tester.id] = d.fieldIds.tester.multi
        ? draft.testers.map(ref)
        : draft.testers[0]
          ? ref(draft.testers[0])
          : null;
    }
    if ('dueDate' in draft) fields.duedate = draft.dueDate;
    if (draft.labels) fields.labels = draft.labels;
    if (draft.description) fields.description = tiptapToAdf(draft.description);

    setSaving(true);
    try {
      if (Object.keys(fields).length) {
        await api.updateIssue(creds, d.key, fields);
        // Fields are in Jira now; keep only the (not yet applied) status change in the draft.
        setDraft((prev) => (prev.transition ? { transition: prev.transition } : {}));
        setEditingDescription(false);
      }
      if (draft.transition) {
        await api.transitionIssue(creds, d.key, draft.transition.id);
        setDraft({});
      }
      toast.success(`${d.key}: saved ${changed.length} change${changed.length === 1 ? '' : 's'}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      toast.error(`Couldn’t save ${d.key}`, {
        description:
          (e as Error).message +
          (draft.transition && Object.keys(fields).length ? ' (any field changes before this were saved)' : ''),
      });
    } finally {
      setSaving(false);
      detail.reload();
      onChanged?.(d.key);
    }
  }

  const jiraUrl = `${creds.site}/browse/${d.key}`;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          save();
        }
      }}
    >
      <SheetHeader className="gap-2 border-b p-5 pr-12">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {d.issueType.iconUrl && <img src={d.issueType.iconUrl} alt="" className="size-4" />}
          {d.parent && (
            <>
              <a
                href={`${creds.site}/browse/${d.parent.key}`}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
                title={d.parent.summary}
              >
                {d.parent.key}
              </a>
              <span>/</span>
            </>
          )}
          <a
            href={jiraUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-link hover:underline"
          >
            {d.key} <ExternalLinkIcon className="size-3" />
          </a>
          <span>· {d.project.name}</span>
        </div>
        <SheetTitle className="sr-only">{d.summary}</SheetTitle>
        <SheetDescription className="sr-only">Details of {d.key}</SheetDescription>
        <EditableSummary
          value={v.summary}
          changed={'summary' in draft}
          editable={can('summary')}
          onChange={(s) => stage('summary', s, s === d.summary)}
        />
        <div className="flex items-center gap-2">
          <StatusMenu
            issueKey={d.key}
            status={d.status}
            category={d.statusCategory}
            staged={draft.transition ?? null}
            onStage={(t) => stage('transition', t ?? undefined, t === null)}
          />
          {draft.transition && <span className="text-xs text-primary">will change on save</span>}
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-[9rem_1fr]">
          <Field label="Assignee" changed={'assignee' in draft}>
            {can('assignee') ? (
              <AssigneePicker
                projectKey={d.project.key}
                value={v.assignee}
                onChange={(a) => stage('assignee', a, sameAssignee(a, original.assignee, me.accountId))}
              />
            ) : (
              <PersonLine person={d.assignee} empty="Unassigned" />
            )}
          </Field>
          {d.fieldIds.tester && (
            <Field label="Tester" changed={'testers' in draft}>
              <TesterField
                projectKey={d.project.key}
                value={v.testers}
                multi={d.fieldIds.tester.multi}
                editable={can(d.fieldIds.tester.id)}
                onChange={(list) => stage('testers', list, samePeople(list, d.testers))}
              />
            </Field>
          )}
          <Field label="Reporter">
            <PersonLine person={d.reporter} empty="—" />
          </Field>
          <Field label="Priority" changed={'priority' in draft}>
            <PriorityField
              detail={d}
              meta={meta.data}
              value={v.priorityId}
              onChange={(id, name) => stage('priority', { id, name }, id === d.priority?.id)}
            />
          </Field>
          <Field label="Original estimate" changed={'original' in draft}>
            <EstimateField
              minutes={v.estimate}
              editable={can('timetracking')}
              onChange={(m) => stage('original', m, m === original.estimate)}
            />
          </Field>
          <Field label="Remaining" changed={'remaining' in draft}>
            <EstimateField
              minutes={v.remaining}
              editable={can('timetracking')}
              onChange={(m) => stage('remaining', m, m === original.remaining)}
            />
          </Field>
          <Field label="Time spent">
            <span className="tabular-nums">{d.timetracking.timeSpent ?? '—'}</span>
          </Field>
          {d.fieldIds.storyPoints && (
            <Field label="Story points" changed={'storyPoints' in draft}>
              <StoryPointsField
                value={v.storyPoints}
                editable={can(d.fieldIds.storyPoints)}
                onChange={(n) => stage('storyPoints', n, n === d.storyPoints)}
              />
            </Field>
          )}
          <Field label="Due date" changed={'dueDate' in draft}>
            <DueDateField
              value={v.dueDate}
              editable={can('duedate')}
              onChange={(x) => stage('dueDate', x, x === d.dueDate)}
            />
          </Field>
          <Field label="Labels" changed={'labels' in draft}>
            <LabelsField
              value={v.labels}
              editable={can('labels')}
              onChange={(l) => stage('labels', l, l.join('\u0000') === d.labels.join('\u0000'))}
            />
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
                {d.fixVersions.map((fv) => (
                  <Badge key={fv.id} variant="secondary">
                    {fv.name}
                  </Badge>
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
          editing={editingDescription}
          onStartEditing={() => setEditingDescription(true)}
          initial={original.description}
          changed={'description' in draft}
          onChange={(doc) => stage('description', doc, docKey(doc) === docKey(original.description))}
        />
      </div>

      {changed.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t bg-card px-5 py-3">
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
            </span>
            <span className="ml-1.5 truncate text-muted-foreground">({changed.map((k) => LABELS[k]).join(', ')})</span>
          </div>
          <Button variant="outline" size="sm" onClick={discard} disabled={saving}>
            Discard
          </Button>
          <Button size="sm" onClick={save} disabled={saving} title="Save (⌘/Ctrl + Enter)">
            {saving && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

function Field({ label, children, changed }: { label: string; children: ReactNode; changed?: boolean }) {
  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1.5 pt-1.5 text-sm text-muted-foreground',
          changed && 'font-medium text-primary',
        )}
      >
        {label}
        {changed && <span className="size-1.5 rounded-full bg-primary" aria-label="changed" />}
      </div>
      <div className="flex min-h-8 min-w-0 items-center text-sm">{children}</div>
    </>
  );
}

/** The site's "Tester" field: one person (picker) or several (chips + add). */
function TesterField({
  projectKey,
  value,
  multi,
  editable,
  onChange,
}: {
  projectKey: string;
  value: Person[];
  multi: boolean;
  editable: boolean;
  onChange: (people: Person[]) => void;
}) {
  const { me } = useSession();
  const toPerson = (a: Assignee): Person | null => (a.kind === 'none' ? null : a.kind === 'me' ? me : a.person);
  if (!editable) {
    return value.length ? (
      <div className="flex flex-wrap gap-3">
        {value.map((p) => (
          <PersonLine key={p.accountId} person={p} empty="—" />
        ))}
      </div>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }
  if (!multi) {
    const current: Assignee = value[0]
      ? value[0].accountId === me.accountId
        ? { kind: 'me' }
        : { kind: 'user', person: value[0] }
      : { kind: 'none' };
    return (
      <AssigneePicker
        projectKey={projectKey}
        value={current}
        noneLabel="No tester"
        onChange={(a) => {
          const p = toPerson(a);
          onChange(p ? [p] : []);
        }}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((p) => (
        <Badge key={p.accountId} variant="secondary" className="h-7 gap-1.5 pr-1 pl-0.5">
          <PersonAvatar person={p} className="size-5" />
          {p.displayName}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x.accountId !== p.accountId))}
            aria-label={`Remove ${p.displayName}`}
            className="rounded-full hover:bg-foreground/10"
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <div className="w-40">
        <AssigneePicker
          projectKey={projectKey}
          value={{ kind: 'none' }}
          noneLabel="Add tester…"
          onChange={(a) => {
            const p = toPerson(a);
            if (p && !value.some((x) => x.accountId === p.accountId)) onChange([...value, p]);
          }}
        />
      </div>
    </div>
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

function EditableSummary({
  value,
  changed,
  editable,
  onChange,
}: {
  value: string;
  changed: boolean;
  editable: boolean;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);

  function commit() {
    const v = text.trim();
    if (v) onChange(v);
    else setText(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <h2
        className={cn(
          'text-xl leading-snug font-semibold',
          editable && '-mx-1.5 cursor-text rounded-md px-1.5 hover:bg-accent',
          changed && 'bg-primary/10',
        )}
        onClick={() => editable && (setText(value), setEditing(true))}
        title={editable ? 'Click to edit' : undefined}
      >
        {value}
      </h2>
    );
  }
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) commit();
        if (e.key === 'Escape') {
          e.stopPropagation(); // don't close the panel
          setText(value);
          setEditing(false);
        }
      }}
      autoFocus
      className="h-9 text-lg font-semibold"
    />
  );
}

function PriorityField({
  detail,
  meta,
  value,
  onChange,
}: {
  detail: IssueDetail;
  meta: EditMeta | null;
  value: string;
  onChange: (id: string, name: string) => void;
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
    <Select value={value} onValueChange={(id) => onChange(id, options.find((o) => o.id === id)?.name ?? '')}>
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

function EstimateField({
  minutes,
  editable,
  onChange,
}: {
  minutes: number;
  editable: boolean;
  onChange: (minutes: number) => void;
}) {
  if (!editable) return <span className="tabular-nums">{minutes ? formatDuration(minutes * 60) : '—'}</span>;
  return <DurationInput value={minutes} onChange={onChange} className="h-8 w-32" />;
}

function StoryPointsField({
  value,
  editable,
  onChange,
}: {
  value: number | null;
  editable: boolean;
  onChange: (v: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  // Follow outside changes (Discard, reload).
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  if (!editable) return <span className="tabular-nums">{value ?? '—'}</span>;
  const commit = () => {
    const n = text.trim() === '' ? null : Number(text);
    if (n !== null && Number.isNaN(n)) setText(value === null ? '' : String(value));
    else if (n !== value) onChange(n);
  };
  return (
    <Input
      type="number"
      min={0}
      step="any"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="h-8 w-24 tabular-nums"
      aria-label="Story points"
    />
  );
}

function DueDateField({
  value,
  editable,
  onChange,
}: {
  value: string | null;
  editable: boolean;
  onChange: (v: string | null) => void;
}) {
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
            onSelect={(day) => {
              setOpen(false);
              if (day) onChange(toISO(day));
            }}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="Clear due date">
          <XIcon />
        </Button>
      )}
    </div>
  );
}

function LabelsField({
  value,
  editable,
  onChange,
}: {
  value: string[];
  editable: boolean;
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState('');
  if (!editable && value.length === 0) return <span className="text-muted-foreground">—</span>;
  const add = () => {
    // Jira labels can't contain spaces.
    const l = text.trim().replace(/\s+/g, '-');
    setText('');
    if (l && !value.includes(l)) onChange([...value, l]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((l) => (
        <Badge key={l} variant="secondary" className="gap-1 pr-1">
          {l}
          {editable && (
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== l))}
              aria-label={`Remove label ${l}`}
              className="rounded-full hover:bg-foreground/10"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {editable && (
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
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
  editing,
  onStartEditing,
  initial,
  changed,
  onChange,
}: {
  detail: IssueDetail;
  editable: boolean;
  site: string;
  editing: boolean;
  onStartEditing: () => void;
  initial: JSONContent;
  changed: boolean;
  onChange: (doc: JSONContent) => void;
}) {
  const html = useMemo(() => cleanHtml(detail.descriptionHtml, site), [detail.descriptionHtml, site]);
  // Editing content the editor can't represent (images, tables, mentions…) would drop it.
  // Content the editor can't change (images, tables, mentions…) shows as placeholders and is kept as-is.
  const hasPlaceholders = adfHasOpaqueContent(detail.description);
  const jiraUrl = `${site}/browse/${detail.key}`;

  return (
    <section className="p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className={cn('flex items-center gap-1.5 text-sm font-semibold', changed && 'text-primary')}>
          Description
          {changed && <span className="size-1.5 rounded-full bg-primary" aria-label="changed" />}
        </h3>
        {editable && !editing && (
          <Button variant="ghost" size="sm" onClick={onStartEditing}>
            <PencilIcon data-icon="inline-start" /> Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="grid gap-1.5">
          <RichTextEditor content={initial} onChange={onChange} autoFocus />
          {hasPlaceholders && (
            <p className="text-xs text-muted-foreground">
              Images, tables, mentions and other Jira-only content appear as grey placeholders and are saved unchanged.
              To edit those parts,{' '}
              <a
                href={jiraUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link underline-offset-2 hover:underline"
              >
                open the issue in Jira
              </a>
              .
            </p>
          )}
        </div>
      ) : html ? (
        <div className="jira-prose text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {editable ? 'No description yet. Click Edit to add one.' : 'No description.'}
        </p>
      )}
    </section>
  );
}
