'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { autoSortTasks } from '@/lib/ai-tools';

/**
 * Quietly sorts newly imported tasks into the student's subjects and sets a priority.
 * Runs once shortly after the app opens, and again whenever the tab is re-focused,
 * which picks up tasks the background ManageBac sync brought in meanwhile.
 */
export function AutoSortTasks() {
  const { user } = useAuth();
  const running = useRef(false);

  useEffect(() => {
    if (!user) return;
    const run = async () => {
      if (running.current || document.visibilityState !== 'visible') return;
      running.current = true;
      try {
        await autoSortTasks();
      } catch {
        // Sorting is a convenience; it must never disturb the app.
      } finally {
        running.current = false;
      }
    };
    const timer = window.setTimeout(run, 2500);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [user]);

  return null;
}
