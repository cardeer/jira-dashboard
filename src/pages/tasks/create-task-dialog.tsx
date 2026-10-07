import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { JSONContent } from '@tiptap/react';
import { AlertCircleIcon, Loader2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssigneePicker, type Assignee } from '@/components/assignee-picker';
import { RichTextEditor } from '@/components/rich-text-editor';
import { api, ApiError } from '@/api';
import { tiptapToAdf } from '@/lib/adf';
import { useSession } from '@/lib/session';
import { useAsync } from '@/useAsync';

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

const LAST_PROJECT_KEY = 'jira-dashboard.lastCreateProject';
const remembered = () => {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) ?? '';
  } catch {
    return '';
  }
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected project (e.g. the selected board's project). */
  defaultProjectKey?: string;
  onCreated: (key: string) => void;
}


export function CreateTaskDialog({ open, onOpenChange, defaultProjectKey, onCreated }: Props) {
  const { creds, me, onUnauthorized } = useSession();
  const [projectKey, setProjectKey] = useState('');
  const [issueTypeId, setIssueTypeId] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState<JSONContent>(EMPTY_DOC);
  const [assignee, setAssignee] = useState<Assignee>({ kind: 'me' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const projectsReq = useAsync((s) => (open ? api.projects(creds, s) : Promise.resolve(null)), [creds, open]);
  const typesReq = useAsync(
    (s) => (open && projectKey ? api.issueTypes(creds, projectKey, s) : Promise.resolve(null)),
    [creds, open, projectKey],
  );

  // Fresh form each time it opens; keep the project choice sensible.
  useEffect(() => {
    if (!open) return;
    setSummary('');
    setDescription(EMPTY_DOC);
    setAssignee({ kind: 'me' });
    setError('');
    setProjectKey(defaultProjectKey || remembered());
  }, [open, defaultProjectKey]);

  // Fall back to the first project when nothing (valid) is pre-selected.
  useEffect(() => {
    const list = projectsReq.data;
    if (list?.length && !list.some((p) => p.key === projectKey)) setProjectKey(list[0].key);
  }, [projectsReq.data, projectKey]);

  // Prefer "Task" when the project has it.
  useEffect(() => {
    const types = typesReq.data;
    if (!types?.length) return;
    if (!types.some((t) => t.id === issueTypeId)) setIssueTypeId((types.find((t) => t.name === 'Task') ?? types[0]).id);
  }, [typesReq.data, issueTypeId]);

  const valid = Boolean(projectKey && issueTypeId && summary.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError('');
    try {
      const { key } = await api.createIssue(creds, {
        projectKey,
        issueTypeId,
        summary,
        description: tiptapToAdf(description),
        assigneeId: assignee.kind === 'me' ? me.accountId : assignee.kind === 'user' ? assignee.person.accountId : null,
      });
      try {
        localStorage.setItem(LAST_PROJECT_KEY, projectKey);
      } catch {
        /* not remembered */
      }
      toast.success(`Created ${key}`, {
        description: summary.trim(),
        action: { label: 'Open', onClick: () => window.open(`${creds.site}/browse/${key}`, '_blank', 'noreferrer') },
      });
      onOpenChange(false);
      onCreated(key);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid min-w-0 grid-cols-1 gap-5">
          <DialogHeader>
            <DialogTitle>Create task</DialogTitle>
            <DialogDescription>Creates a new issue in Jira.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <Label>Project</Label>
              <Select value={projectKey} onValueChange={setProjectKey} disabled={!projectsReq.data}>
                <SelectTrigger className="w-full min-w-0" aria-label="Project">
                  <SelectValue placeholder="Loading projects…" />
                </SelectTrigger>
                <SelectContent>
                  {(projectsReq.data ?? []).map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.name} ({p.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label>Issue type</Label>
              <Select value={issueTypeId} onValueChange={setIssueTypeId} disabled={!typesReq.data}>
                <SelectTrigger className="w-full min-w-0" aria-label="Issue type">
                  <SelectValue placeholder={projectKey ? 'Loading types…' : 'Pick a project'} />
                </SelectTrigger>
                <SelectContent>
                  {(typesReq.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.iconUrl && <img src={t.iconUrl} alt="" className="size-4" />}
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {typesReq.error && <p className="-mt-3 text-xs text-destructive">{typesReq.error.message}</p>}

          <div className="grid gap-1.5">
            <Label htmlFor="task-summary">Summary</Label>
            <Input id="task-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What needs to be done?" required autoFocus />
          </div>

          <div className="grid gap-1.5">
            <Label>Description</Label>
            <RichTextEditor content={EMPTY_DOC} onChange={setDescription} placeholder="Optional details" />
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label>Assignee</Label>
            <AssigneePicker projectKey={projectKey} value={assignee} onChange={setAssignee} />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
