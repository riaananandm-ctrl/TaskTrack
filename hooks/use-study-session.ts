'use client';

import { useCallback, useState } from 'react';
import {
  createSession,
  createSessionForSubject,
  findActiveSessionForTask,
  type StudySession,
} from '@/lib/study-sessions';

/**
 * Opens the persistent study session for a task, reusing the task's active session
 * when one exists so repeated clicks resume the same conversation. Used by every
 * entry point (task card, calendar, planning, notifications) so they all behave
 * identically.
 */
export function useStudySessionOpener() {
  const [session, setSession] = useState<StudySession | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openForTask = useCallback(
    async (task: { id?: string | null; title: string } | null) => {
      if (opening) return;
      setOpening(true);
      setError(null);
      try {
        if (task?.id) {
          const existing = await findActiveSessionForTask(task.id);
          setSession(existing ?? (await createSession({ id: task.id, title: task.title })));
        } else {
          setSession(await createSessionForSubject(task?.title || 'General study session'));
        }
      } catch {
        setError('Could not open a study session. Please try again.');
      } finally {
        setOpening(false);
      }
    },
    [opening]
  );

  const close = useCallback(() => setSession(null), []);

  return { session, openForTask, close, opening, error };
}
