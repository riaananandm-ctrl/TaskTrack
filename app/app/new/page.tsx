'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { CheckCheck, Eye, Inbox, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import type { Subject, Task } from '@/lib/types';
import { TaskCard } from '@/components/task-card';
import { TaskDialog } from '@/components/task-dialog';
import { Button } from '@/components/ui/button';
import { UpcomingIcon } from '@/components/brand-icons';
import { TASKS_SORTED_EVENT } from '@/lib/ai-tools';
import { markTasksSeen, NEW_TASKS_CHANGED_EVENT, startOfTodayIso } from '@/lib/new-tasks';
import { cn } from '@/lib/utils';

/** Tasks the student has not opened yet, plus everything added today. */
export default function NewTasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!user) return;
      if (!options?.silent) setLoading(true);
      const today = startOfTodayIso();
      const [tasksRes, subjectsRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('*, subject:subjects(*)')
          .eq('is_archived', false)
          .or(`seen_at.is.null,created_at.gte.${today}`)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('subjects').select('*').eq('is_archived', false),
      ]);
      if (tasksRes.error) {
        setError('We couldn’t load your new tasks. Please refresh to try again.');
      } else {
        setError(null);
        setTasks((tasksRes.data as unknown as Task[]) || []);
      }
      setSubjects((subjectsRes.data as Subject[]) || []);
      setLoading(false);
    },
    [user]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when tasks are sorted by the AI or marked seen elsewhere.
  useEffect(() => {
    const refresh = () => load({ silent: true });
    window.addEventListener(TASKS_SORTED_EVENT, refresh);
    window.addEventListener(NEW_TASKS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(TASKS_SORTED_EVENT, refresh);
      window.removeEventListener(NEW_TASKS_CHANGED_EVENT, refresh);
    };
  }, [load]);

  const { unseen, seenToday } = useMemo(() => {
    const today = new Date(startOfTodayIso()).getTime();
    return {
      unseen: tasks.filter((t) => !t.seen_at),
      seenToday: tasks.filter((t) => t.seen_at && new Date(t.created_at).getTime() >= today),
    };
  }, [tasks]);

  const openTask = (task: Task) => {
    setEditing(task);
    setDialogOpen(true);
  };

  const markOne = async (task: Task) => {
    // Optimistic: the card moves to "Added today" (or leaves) straight away.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, seen_at: new Date().toISOString() } : t)));
    await markTasksSeen([task.id]);
  };

  const markAll = async () => {
    setMarkingAll(true);
    const ids = unseen.map((t) => t.id);
    const ok = await markTasksSeen(ids);
    if (ok) {
      const now = new Date().toISOString();
      setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, seen_at: now } : t)));
    }
    setMarkingAll(false);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-4">
          <UpcomingIcon size={48} />
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">New Tasks</h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Tasks you haven&rsquo;t opened yet, and everything added today. New ManageBac deadlines show up here first.
            </p>
          </div>
        </div>
        {unseen.length > 0 && (
          <Button onClick={markAll} disabled={markingAll} variant="outline" className="self-start sm:self-auto">
            {markingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
            Mark all as seen
          </Button>
        )}
      </div>

      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : unseen.length === 0 && seenToday.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Section
            title="Not opened yet"
            count={unseen.length}
            accent
            emptyText="You’ve opened everything. Nice."
          >
            {unseen.map((task) => (
              <NewTaskItem key={task.id} task={task} unseen onOpen={openTask} onMarkSeen={markOne} onChanged={load} />
            ))}
          </Section>

          {seenToday.length > 0 && (
            <Section title="Added today" count={seenToday.length}>
              {seenToday.map((task) => (
                <NewTaskItem key={task.id} task={task} onOpen={openTask} onChanged={load} />
              ))}
            </Section>
          )}
        </>
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        subjects={subjects}
        onSaved={() => load({ silent: true })}
      />
    </div>
  );
}

function Section({
  title,
  count,
  accent,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  accent?: boolean;
  emptyText?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
            accent && count > 0 ? 'bg-[#22B29E]/15 text-[#17806F] dark:text-[#5FD3C0]' : 'bg-muted text-muted-foreground'
          )}
        >
          {count}
        </span>
      </div>
      {count === 0 && emptyText ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
      )}
    </section>
  );
}

function NewTaskItem({
  task,
  unseen,
  onOpen,
  onMarkSeen,
  onChanged,
}: {
  task: Task;
  unseen?: boolean;
  onOpen: (task: Task) => void;
  onMarkSeen?: (task: Task) => void;
  onChanged: (options?: { silent?: boolean }) => void;
}) {
  const added = formatDistanceToNow(parseISO(task.created_at), { addSuffix: true });
  return (
    <div className={cn('rounded-xl', unseen && 'ring-2 ring-[#22B29E]/35 ring-offset-2 ring-offset-background')}>
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {unseen && <span className="h-2 w-2 rounded-full bg-[#22B29E]" aria-hidden />}
          {unseen && <span className="font-semibold text-[#17806F] dark:text-[#5FD3C0]">New</span>}
          <span>Added {added}</span>
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
          >
            Open
          </button>
          {unseen && onMarkSeen && (
            <button
              type="button"
              onClick={() => onMarkSeen(task)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Eye className="h-3.5 w-3.5" /> Seen
            </button>
          )}
        </span>
      </div>
      <TaskCard task={task} onEdit={onOpen} onChanged={onChanged} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#22B29E]/15">
        <Inbox className="h-7 w-7 text-[#17806F] dark:text-[#5FD3C0]" />
      </span>
      <h3 className="mt-4 text-lg font-semibold">You&rsquo;re all caught up</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Nothing new today. When ManageBac adds a deadline, it will appear here until you open it.
      </p>
      <Button asChild variant="outline" className="mt-5">
        <Link href="/app/tasks">Go to My Tasks</Link>
      </Button>
    </div>
  );
}
