import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircleIcon, Loader2Icon, Trash2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  valid: boolean;
  onSave: () => Promise<void>;
  /** Shown only when editing. `what` names the entry in the confirmation. */
  onDelete?: { what: string; run: () => Promise<void> };
  children: ReactNode;
}

/** Form dialog with save, a confirmed delete and inline errors, shared by holidays and leaves. */
export function EntryDialog({ open, onOpenChange, title, description, valid, onSave, onDelete, children }: Props) {
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState('');

  async function run(kind: 'save' | 'delete', fn: () => Promise<void>) {
    setBusy(kind);
    setError('');
    try {
      await fn();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) void run('save', onSave);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError('');
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid min-w-0 grid-cols-1 gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {children}

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            {onDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive hover:text-destructive sm:mr-auto" disabled={busy !== null}>
                    {busy === 'delete' ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {onDelete.what}?</AlertDialogTitle>
                    <AlertDialogDescription>The row is removed from the Google Sheet. This can’t be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => void run('delete', onDelete.run)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || busy !== null}>
              {busy === 'save' && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
