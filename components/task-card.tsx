'use client';

import { Task, CATEGORY_LABELS, PRIORITY_LABELS } from '@/lib/types';
import { MANAGEBAC_SOURCE, MANAGEBAC_SOURCE_LABEL } from '@/lib/managebac';
import { getDueDateLabel, getPriorityBadgeClass, isOverdue, isDueToday } from '@/lib/task-utils';
import { getDeadlineStatus } from '@/lib/deadline-status';
import { supabase } from '@/lib/supabase/client';
import { awardXp, upsertOnboardingProgress } from '@/lib/gamification';
import { CheckCircle2, Circle, Clock, Link as LinkIcon, Bell, MoreVertical, Copy, Archive, Trash2, Pencil, Sparkles, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StudySessionPanel } from '@/components/study-session-panel';
import { createSession, findActiveSessionForTask, type StudySession } from '@/lib/study-sessions';
import { completeStudySessionsForTask } from '@/lib/study-schedule';

interface TaskCardProps {
  task: Task;
  onEdit?: (task: Task) => void;
  /** Refresh the parent's data. A silent refresh must not unmount this card. */
  onChanged?: (options?: { silent?: boolean }) => void;
  compact?: boolean;
}

export function TaskCard({ task, onEdit, onChanged, compact }: TaskCardProps) {
  const [updating, setUpdating] = useState(false);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [starting, setStarting] = useState(false);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState<Task['status'] | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const displayTask: Task = optimisticStatus ? { ...task, status: optimisticStatus, completed_at: optimisticStatus === 'completed' ? new Date().toISOString() : null } : task;

  const toggleComplete = async () => {
    if (updating) return;
    setUpdating(true);
    setCompleteError(null);
    const newStatus = task.status === 'completed' ? 'not_started' : 'completed';
    setOptimisticStatus(newStatus);
    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          status: newStatus,
          completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
        })
        .eq('id', task.id);
      if (error) throw error;
      if (newStatus === 'completed') {
        await completeStudySessionsForTask(task.id);
        await awardXp(20, 'task_completed');
        await upsertOnboardingProgress({ step_first_task_completed: true }).catch(() => {});
      }
      onChanged?.({ silent: true });
    } catch {
      setOptimisticStatus(null);
      setCompleteError('Could not complete this task. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const duplicateTask = async () => {
    const { ...rest } = task;
    await supabase.from('tasks').insert({
      user_id: task.user_id,
      title: `${task.title} (copy)`,
      subject_id: task.subject_id,
      description: task.description,
      category: task.category,
      due_date: task.due_date,
      due_time: task.due_time,
      priority: task.priority,
      status: 'not_started',
      estimated_minutes: task.estimated_minutes,
      notes: task.notes,
      external_link: task.external_link,
    });
    onChanged?.();
  };

  const archiveTask = async () => {
    await supabase.from('tasks').update({ is_archived: true, status: 'archived' }).eq('id', task.id);
    onChanged?.();
  };

  const deleteTask = async () => {
    await supabase.from('tasks').delete().eq('id', task.id);
    onChanged?.();
  };

  // Open the task's existing active session, or create one. This is the persistent
  // equivalent of the old temporary chat, so a reopened task keeps its history.
  const openStudySession = async () => {
    if (starting) return;
    setStarting(true);
    setStudyError(null);
    try {
      const existing = await findActiveSessionForTask(task.id);
      const session = existing ?? (await createSession({ id: task.id, title: task.title }));
      setActiveSession(session);
    } catch {
      setStudyError('Could not open a study session. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const subjectColour = displayTask.subject?.colour || '#64748B';
  const deadlineStatus = getDeadlineStatus(displayTask);
  const overdue = deadlineStatus === 'overdue';
  const dueToday = isDueToday(displayTask);
  const isCompleted = deadlineStatus === 'completed';

  return (
    <div
      className={cn(
        'group rounded-xl border bg-card p-4 transition-all hover:shadow-soft',
        overdue ? 'border-red-200 dark:border-red-900' : dueToday ? 'border-orange-200 dark:border-orange-900' : 'border-border'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Complete button */}
        <button
          type="button"
          onClick={toggleComplete}
          disabled={updating}
          className="mt-0.5 flex-shrink-0"
          aria-label={isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
        >
          {updating ? (
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
          ) : isCompleted ? (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <Circle className="w-5 h-5 text-muted-foreground hover:text-primary transition-colors" />
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm font-medium', isCompleted && 'line-through text-muted-foreground')}>
                {displayTask.title}
              </p>
              {!compact && displayTask.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{displayTask.description}</p>
              )}
            </div>

            {/* Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent transition-all">
                  <MoreVertical className="w-4 h-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(task)}>
                    <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={openStudySession}>
                  <Sparkles className="w-3.5 h-3.5 mr-2" /> Study Session
                </DropdownMenuItem>
                <DropdownMenuItem onClick={duplicateTask}>
                  <Copy className="w-3.5 h-3.5 mr-2" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={archiveTask}>
                  <Archive className="w-3.5 h-3.5 mr-2" /> Archive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={deleteTask} className="text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {displayTask.subject && (
              <span
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${subjectColour}15`, color: subjectColour }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: subjectColour }} />
                {displayTask.subject.name}
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {CATEGORY_LABELS[displayTask.category]}
            </span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', getPriorityBadgeClass(displayTask.priority))}>
              {PRIORITY_LABELS[displayTask.priority]}
            </span>
            {displayTask.external_source === MANAGEBAC_SOURCE && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 font-medium">
                <LinkIcon className="w-3 h-3" />
                {MANAGEBAC_SOURCE_LABEL}
              </span>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {displayTask.due_date && (
              <span
                className={cn(
                  'flex items-center gap-1 text-xs',
                  overdue ? 'text-red-600 font-medium' : dueToday ? 'text-orange-600 font-medium' : 'text-muted-foreground'
                )}
              >
                <Clock className="w-3 h-3" />
                {getDueDateLabel(displayTask)}
              </span>
            )}
            {displayTask.external_link && (
              <a
                href={displayTask.external_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <LinkIcon className="w-3 h-3" /> Link
              </a>
            )}
            <button
              onClick={openStudySession}
              disabled={starting}
              className="flex items-center gap-1 text-xs text-navy-600 hover:text-navy-700 font-medium transition-colors disabled:opacity-50"
            >
              {starting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              Study Session
            </button>
          </div>

          {(studyError || completeError) && (
            <p className="text-xs text-destructive mt-2">{completeError || studyError}</p>
          )}
        </div>
      </div>

      {activeSession && (
        <StudySessionPanel
          session={activeSession}
          open={!!activeSession}
          onClose={() => setActiveSession(null)}
          onActivity={() => onChanged?.({ silent: true })}
          onStatusChange={setActiveSession}
        />
      )}
    </div>
  );
}
