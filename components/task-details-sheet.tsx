'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Clock, ExternalLink, Info, Loader2, Pencil, PenLine, Sparkles, StickyNote } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase/client';
import { markTasksSeen } from '@/lib/new-tasks';
import { safeHttpUrl } from '@/lib/safe-url';
import { getDueDateLabel, getPriorityBadgeClass, isDueToday } from '@/lib/task-utils';
import { getDeadlineStatus } from '@/lib/deadline-status';
import { MANAGEBAC_SOURCE, MANAGEBAC_SOURCE_LABEL } from '@/lib/managebac';
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, type Subject, type Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { splitLinks, looksCutOff } from '@/lib/task-description';

const NO_SUBJECT = '__none__';

interface TaskDetailsSheetProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleComplete: () => void;
  completing: boolean;
  onStudy: () => void;
  studying: boolean;
  onEdit?: (task: Task) => void;
  /** Called after the subject is changed here. */
  onChanged?: (options?: { silent?: boolean }) => void;
}

/** Description text with https links made clickable and line breaks kept. */
function DescriptionText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 break-all">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </p>
  );
}

/**
 * The full task, opened by clicking a task card: everything the card shortens to one
 * line (the whole description, notes, link), plus a subject switcher. Changing the
 * subject here teaches the auto-sorter (see task_subject_corrections).
 */
export function TaskDetailsSheet({
  task,
  open,
  onOpenChange,
  onToggleComplete,
  completing,
  onStudy,
  studying,
  onEdit,
  onChanged,
}: TaskDetailsSheetProps) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(task.subject_id);
  const [savingSubject, setSavingSubject] = useState(false);
  const [subjectError, setSubjectError] = useState<string | null>(null);

  useEffect(() => setSubjectId(task.subject_id), [task.subject_id]);

  useEffect(() => {
    if (!open) return;
    if (!task.seen_at) void markTasksSeen([task.id]);
    if (subjects) return;
    let cancelled = false;
    supabase
      .from('subjects')
      .select('*')
      .eq('is_archived', false)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setSubjects((data ?? []) as Subject[]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, task.id, task.seen_at, subjects]);

  const changeSubject = async (value: string) => {
    const next = value === NO_SUBJECT ? null : value;
    if (next === subjectId) return;
    const previous = subjectId;
    setSubjectId(next);
    setSavingSubject(true);
    setSubjectError(null);
    const { error } = await supabase.from('tasks').update({ subject_id: next }).eq('id', task.id);
    setSavingSubject(false);
    if (error) {
      setSubjectId(previous);
      setSubjectError('Could not change the subject. Please try again.');
      return;
    }
    onChanged?.({ silent: true });
  };

  const subject = subjects?.find((s) => s.id === subjectId) ?? (subjectId === task.subject_id ? task.subject : null);
  const colour = subject?.colour || '#64748B';
  const deadline = getDeadlineStatus(task);
  const isCompleted = deadline === 'completed';
  const link = safeHttpUrl(task.external_link);
  const fromManageBac = task.external_source === MANAGEBAC_SOURCE;
  const description = task.description?.trim() || '';
  const notes = task.notes?.trim() || '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <span className="h-1.5 w-full flex-shrink-0" style={{ background: colour }} aria-hidden />
        <div className="space-y-5 p-6">
          <SheetHeader className="space-y-2 pr-6 text-left">
            <SheetTitle className={cn('text-lg leading-snug', isCompleted && 'line-through text-muted-foreground')}>
              {task.title}
            </SheetTitle>
            <SheetDescription asChild>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', getPriorityBadgeClass(task.priority))}>
                  {PRIORITY_LABELS[task.priority]}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{CATEGORY_LABELS[task.category]}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{STATUS_LABELS[task.status]}</span>
                {fromManageBac && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    {MANAGEBAC_SOURCE_LABEL}
                  </span>
                )}
              </div>
            </SheetDescription>
          </SheetHeader>

          <dl className="grid grid-cols-[auto,1fr] items-center gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Due</dt>
            <dd
              className={cn(
                'flex items-center gap-1.5',
                deadline === 'overdue' ? 'font-medium text-red-600' : isDueToday(task) ? 'font-medium text-orange-600' : ''
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              {task.due_date ? getDueDateLabel(task) : 'No due date'}
            </dd>

            <dt className="text-muted-foreground">Subject</dt>
            <dd className="flex items-center gap-2">
              <Select value={subjectId ?? NO_SUBJECT} onValueChange={changeSubject} disabled={savingSubject || !subjects}>
                <SelectTrigger className="h-8 w-full max-w-[240px]" aria-label="Subject">
                  <SelectValue placeholder={subject?.name ?? 'No subject'}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
                      {subject?.name ?? 'No subject'}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUBJECT}>No subject</SelectItem>
                  {(subjects ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: s.colour || '#64748B' }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {savingSubject && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </dd>

            {task.estimated_minutes ? (
              <>
                <dt className="text-muted-foreground">Time</dt>
                <dd>About {task.estimated_minutes} min</dd>
              </>
            ) : null}
          </dl>
          {subjectError ? (
            <p className="-mt-2 text-xs text-destructive">{subjectError}</p>
          ) : fromManageBac ? (
            <p className="-mt-2 text-xs text-muted-foreground">Wrong subject? Change it here and TaskTrack will sort tasks like this one the same way next time.</p>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h3>
            {description ? (
              <div className="rounded-lg border bg-muted/30 p-3">
                <DescriptionText text={description} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
            {fromManageBac && looksCutOff(description) && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                ManageBac only shares the start of the description with calendars. Open the task on ManageBac for the rest and any attachments.
              </p>
            )}
          </section>

          {notes && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <StickyNote className="h-3.5 w-3.5" /> Your notes
              </h3>
              <DescriptionText text={notes} />
            </section>
          )}

          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <ExternalLink className="h-4 w-4" /> Open link
            </a>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button size="sm" variant={isCompleted ? 'outline' : 'default'} onClick={onToggleComplete} disabled={completing}>
              {completing ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : isCompleted ? (
                <Circle className="mr-1.5 h-4 w-4" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
              )}
              {isCompleted ? 'Mark as not done' : 'Mark as done'}
            </Button>
            <Button size="sm" variant="outline" onClick={onStudy} disabled={studying}>
              {studying ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              Study Session
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/app/tasks/${task.id}/coach`}>
                <PenLine className="mr-1.5 h-4 w-4" /> Rewrite Coach
              </Link>
            </Button>
            {onEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  onEdit(task);
                }}
              >
                <Pencil className="mr-1.5 h-4 w-4" /> Edit
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
