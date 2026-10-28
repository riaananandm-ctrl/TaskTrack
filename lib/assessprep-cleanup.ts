import { supabase } from '@/lib/supabase/client';
import { isAssessPrepTask, getTaskDeadline } from '@/lib/deadline-status';
import { Task } from '@/lib/types';

/**
 * Delete the signed-in user's AssessPrep tasks whose deadlines have passed.
 *
 * A task qualifies only when:
 * 1. It belongs to the current user (enforced by RLS).
 * 2. Its description contains the word "AssessPrep" (case-insensitive, word boundary).
 * 3. It has a valid due date that is in the past.
 *
 * This is idempotent — once deleted, the rows are gone and subsequent calls
 * are a no-op. It never runs during render; it is called after a session loads
 * and when the Tasks page mounts.
 */
export async function cleanupPastAssessPrepTasks(userId: string): Promise<number> {
  if (!userId) return 0;

  const { data, error } = await supabase
    .from('tasks')
    .select('id, description, due_date, due_time')
    .eq('user_id', userId)
    .neq('status', 'completed');

  if (error || !data) return 0;

  const now = new Date();
  const toDelete = (data as unknown as Pick<Task, 'id' | 'description' | 'due_date' | 'due_time'>[])
    .filter((t) => {
      if (!isAssessPrepTask({ description: t.description } as Task)) return false;
      const deadline = getTaskDeadline({ due_date: t.due_date, due_time: t.due_time } as Task);
      return deadline !== null && deadline.getTime() < now.getTime();
    })
    .map((t) => t.id);

  if (toDelete.length === 0) return 0;

  const { error: deleteError } = await supabase
    .from('tasks')
    .delete()
    .in('id', toDelete);

  if (deleteError) return 0;
  return toDelete.length;
}
