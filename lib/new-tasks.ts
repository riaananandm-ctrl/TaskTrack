'use client';

import { useEffect, useState } from 'react';
import { startOfDay } from 'date-fns';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';

/**
 * "New tasks": tasks the student has not opened yet (seen_at is NULL), plus anything
 * added today. Imported tasks (ManageBac) start unseen; tasks the student creates are
 * marked seen by a database trigger.
 */

/** Fired whenever tasks are marked seen, so the sidebar count updates at once. */
export const NEW_TASKS_CHANGED_EVENT = 'tasktrack:new-tasks-changed';

function announce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NEW_TASKS_CHANGED_EVENT));
}

/** Mark tasks as seen. Already-seen tasks keep their original seen time. */
export async function markTasksSeen(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const { error } = await supabase
    .from('tasks')
    .update({ seen_at: new Date().toISOString() })
    .in('id', ids)
    .is('seen_at', null);
  if (error) return false;
  announce();
  return true;
}

/** ISO timestamp for the start of today in the student's local time. */
export function startOfTodayIso(): string {
  return startOfDay(new Date()).toISOString();
}

/** Number of unseen, active tasks, for the sidebar badge. */
export function useNewTaskCount(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const { count: n, error } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .is('seen_at', null)
        .eq('is_archived', false)
        .neq('status', 'completed');
      if (!cancelled) setCount(error ? 0 : n || 0);
    };
    load();
    const interval = window.setInterval(load, 60_000);
    window.addEventListener(NEW_TASKS_CHANGED_EVENT, load);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener(NEW_TASKS_CHANGED_EVENT, load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [user]);

  return count;
}
