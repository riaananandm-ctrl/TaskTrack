'use client';

import { useCallback, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Bell } from 'lucide-react';
import { ReminderDialog, ReminderPrefill } from '@/components/reminder-dialog';
import { Subject, Task } from '@/lib/types';
import { suggestReminderTimes } from '@/lib/reminder-utils';

export interface CreatedTask {
  id: string;
  title: string;
  subject_id: string | null;
  due_date: string | null;
  due_time: string | null;
}

interface UseReminderPromptOptions {
  subjects: Subject[];
  tasks: Task[];
}

/**
 * Provides the post-creation reminder flow: an `onCreated` callback to pass to
 * TaskDialog, and a `dialogs` node to render. When a task is created the user is
 * asked whether to add reminders, and is offered three pre-computed, never-past
 * suggestions.
 */
export function useReminderPrompt({ subjects, tasks }: UseReminderPromptOptions) {
  const [promptTask, setPromptTask] = useState<CreatedTask | null>(null);
  const [prefill, setPrefill] = useState<ReminderPrefill | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const onCreated = useCallback((created: CreatedTask) => {
    setPromptTask(created);
  }, []);

  const handleNo = useCallback(() => {
    setPromptTask(null);
  }, []);

  const handleYes = useCallback(() => {
    if (!promptTask) return;
    const subjectName = subjects.find((s) => s.id === promptTask.subject_id)?.name || null;
    setPrefill({
      title: promptTask.title,
      taskId: promptTask.id,
      subjectName,
      dueDate: promptTask.due_date,
      suggestions: suggestReminderTimes(promptTask.due_date, promptTask.due_time, 3),
    });
    setPromptTask(null);
    setDialogOpen(true);
  }, [promptTask, subjects]);

  const dialogs = (
    <>
      <Dialog open={!!promptTask} onOpenChange={() => {}}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Would you like to add a reminder for this task?</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-3 py-1">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center flex-shrink-0">
              <Bell className="w-4 h-4 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              We&apos;ll suggest three reminder times for{' '}
              <span className="font-medium text-foreground">{promptTask?.title}</span> — you can edit or remove each one.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleNo}>No</Button>
            <Button onClick={handleYes}>Yes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReminderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tasks={tasks.filter((t) => !t.is_archived)}
        prefill={prefill}
      />
    </>
  );

  return { onCreated, dialogs };
}
