'use client';

import { useCallback, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2, Loader2, Check, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { daysBetween } from '@/lib/revision-plan';
import { buildMilestones, PROJECT_LABEL, type ProjectKind } from '@/lib/milestones';
import {
  createProject, deleteProject, listProjects, localToday, setMilestoneDone,
  type IbProject, type MilestoneTask,
} from '@/lib/ib-data';

export function ProjectsTab({ subjects }: { subjects: { id: string; name: string }[] }) {
  const [projects, setProjects] = useState<IbProject[]>([]);
  const [tasks, setTasks] = useState<MilestoneTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<IbProject | null>(null);
  const today = localToday();

  const load = useCallback(async () => {
    try {
      const r = await listProjects();
      setProjects(r.projects);
      setTasks(r.tasks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your projects could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (t: MilestoneTask) => {
    const done = t.status !== 'completed';
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: done ? 'completed' : 'not_started' } : x)));
    try {
      await setMilestoneDone(t.id, done);
    } catch {
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteProject(deleting.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That project could not be deleted.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          Split your Extended Essay, IAs or TOK essay into checkpoints between now and the deadline. Each checkpoint is
          added to My Tasks and your calendar, and you get the usual reminder the day before it&rsquo;s due.
        </p>
        <Button onClick={() => setAdding(true)} className="gap-2">
          <Plus className="w-4 h-4" /> New project
        </Button>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold">No projects yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Add your EE or an IA and its deadline. TaskTrack plans the checkpoints for you.</p>
          <Button onClick={() => setAdding(true)} className="mt-4 gap-2"><Plus className="w-4 h-4" /> Plan a project</Button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {projects.map((p) => {
            const steps = tasks
              .filter((t) => t.external_uid?.startsWith(`${p.id}:`))
              .sort((a, b) => Number(a.external_uid!.split(':')[1]) - Number(b.external_uid!.split(':')[1]));
            const done = steps.filter((s) => s.status === 'completed').length;
            const next = steps.find((s) => s.status !== 'completed');
            const days = daysBetween(today, p.due_date);
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-primary">{PROJECT_LABEL[p.kind]}{p.subject_name ? ` · ${p.subject_name}` : ''}</p>
                    <p className="font-semibold truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Due {format(parseISO(p.due_date), 'd MMM yyyy')} &middot; {days < 0 ? `${-days} days ago` : days === 0 ? 'today' : `${days} days left`}
                    </p>
                  </div>
                  <button onClick={() => setDeleting(p)} aria-label={`Delete ${p.title}`} className="tap-target p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{done} of {steps.length} checkpoints</span>
                    {next && <span>Next: {next.due_date ? format(parseISO(next.due_date), 'd MMM') : ''}</span>}
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {steps.map((s) => {
                    const isDone = s.status === 'completed';
                    const late = !isDone && !!s.due_date && s.due_date < today;
                    return (
                      <li key={s.id} className="flex items-start gap-2.5">
                        <button
                          onClick={() => toggle(s)}
                          role="checkbox"
                          aria-checked={isDone}
                          aria-label={`Mark "${s.title}" as ${isDone ? 'not done' : 'done'}`}
                          className={cn('tap-target mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border', isDone ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}
                        >
                          {isDone && <Check className="w-3.5 h-3.5" />}
                        </button>
                        <span className={cn('flex-1 text-sm', isDone && 'line-through text-muted-foreground')}>
                          {s.title.replace(`${PROJECT_LABEL[p.kind]}: `, '')}
                        </span>
                        <span className={cn('text-xs whitespace-nowrap', late ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground')}>
                          {s.due_date ? format(parseISO(s.due_date), 'd MMM') : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <NewProjectDialog open={adding} onClose={() => setAdding(false)} onSaved={load} subjects={subjects} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              Its unfinished checkpoints are removed from My Tasks. Finished ones stay in your history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewProjectDialog({ open, onClose, onSaved, subjects }: { open: boolean; onClose: () => void; onSaved: () => void; subjects: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<ProjectKind>('ee');
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('none');
  const [start, setStart] = useState(localToday());
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setStart(localToday());
      setDue('');
      setError(null);
    }
  }, [open]);

  const preview = due && due > start ? buildMilestones(kind, start, due) : [];

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError('Give it a title, e.g. your research question or topic.');
    if (!due || due <= start) return setError('The deadline must be after the start date.');
    if (due <= localToday()) return setError('The deadline must be in the future.');
    setSaving(true);
    try {
      const subject = subjects.find((s) => s.id === subjectId);
      await createProject({ kind, title, subject_name: subject?.name ?? null, subject_id: subject?.id ?? null, start_date: start, due_date: due });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That project could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>We&rsquo;ll split it into checkpoints you can tick off.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Project type">
            {(['ee', 'ia', 'tok'] as ProjectKind[]).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn('rounded-lg border px-2 py-2 text-xs font-medium', kind === k ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent')}
              >
                {k === 'ee' ? 'Extended Essay' : k === 'ia' ? 'IA' : 'TOK essay'}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-title">Title or topic</Label>
            <Input id="proj-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. How did… / Investigating…" />
          </div>
          <div className="space-y-1.5">
            <Label>Subject (optional)</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No subject</SelectItem>
                {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="proj-start">Start</Label>
              <Input id="proj-start" type="date" value={start} onChange={(e) => setStart(e.target.value || localToday())} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-due">Final deadline</Label>
              <Input id="proj-due" type="date" value={due} min={start} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          {preview.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-semibold mb-1.5">{preview.length} checkpoints</p>
              <ol className="space-y-0.5 text-xs text-muted-foreground">
                {preview.map((m) => (
                  <li key={m.n} className="flex gap-2">
                    <span className="w-12 flex-shrink-0">{format(parseISO(m.due_date), 'd MMM')}</span>
                    <span>{m.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create checkpoints'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
