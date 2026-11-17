'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Task } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { getDeadlineStatus } from '@/lib/deadline-status';
import { X, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { isPriorityAlertDismissed, dismissPriorityAlert } from '@/lib/session-keys';

export function PriorityAlertBanner() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (isPriorityAlertDismissed(user.id)) return;

    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('tasks')
        .select('*, subject:subjects(name)')
        .in('priority', ['high', 'urgent'])
        .neq('status', 'completed')
        .eq('is_archived', false);

      if (cancelled) return;

      const sorted = ((data as unknown as Task[]) || [])
        .filter((t) => getDeadlineStatus(t) === 'upcoming')
        .sort((a, b) => {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return parseISO(a.due_date).getTime() - parseISO(b.due_date).getTime();
      });

      if (sorted.length > 0) {
        setTasks(sorted);
        setVisible(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const dismiss = () => {
    if (user) dismissPriorityAlert(user.id);
    setVisible(false);
  };

  if (!visible || tasks.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border-2 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-red-900 dark:text-red-200">
              You have {tasks.length} upcoming task{tasks.length !== 1 ? 's' : ''} !!!
            </p>
            <button
              onClick={dismiss}
              className="tap-target p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex-shrink-0"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4 text-red-700 dark:text-red-300" />
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className={task.priority === 'urgent' ? 'font-semibold text-red-800 dark:text-red-300' : 'font-medium text-red-900 dark:text-red-200'}>
                  {task.title}
                </span>
                {task.subject?.name && (
                  <span className="text-xs text-red-700 dark:text-red-300">· {task.subject.name}</span>
                )}
                <span className="text-xs text-red-700 dark:text-red-300">
                  · {task.due_date ? `Due ${format(parseISO(task.due_date), 'EEE, MMM d')}` : 'No due date'}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/app/tasks"
            onClick={dismiss}
            className="inline-block mt-2 text-xs font-medium text-red-800 dark:text-red-300 hover:underline"
          >
            View all tasks
          </Link>
        </div>
      </div>
    </div>
  );
}
