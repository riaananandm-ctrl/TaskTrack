import { Task } from '@/lib/types';
import { parseISO, isToday, isPast } from 'date-fns';

export type DeadlineStatus = 'completed' | 'overdue' | 'upcoming' | 'unscheduled';

export const DEADLINE_STATUS_LABELS: Record<DeadlineStatus, string> = {
  completed: 'Completed',
  overdue: 'Overdue',
  upcoming: 'Upcoming',
  unscheduled: 'Unscheduled',
};

/**
 * Check if a task description contains the word "AssessPrep" (case-insensitive).
 * Matches the whole word, not substrings.
 */
export function isAssessPrepTask(task: Task): boolean {
  if (!task.description) return false;
  return /\bassessprep\b/i.test(task.description);
}

/**
 * A pen-and-paper test is sat in class, so it is done once its time has passed.
 * Keep in step with public.tasktrack_is_pen_paper in the database.
 */
export function isPenPaperTest(task: Pick<Task, 'title' | 'description'>): boolean {
  return /pen[\s-]*(and|&|n|\/)[\s-]*paper/i.test(`${task.title ?? ''} ${task.description ?? ''}`);
}

/**
 * Parse a task's due date + time into a Date object, or null if invalid/missing.
 * For all-day tasks (no due_time), the deadline is the END of that local day.
 * For timed tasks, the deadline is the date + time in the user's local timezone.
 */
export function getTaskDeadline(task: Task): Date | null {
  if (!task.due_date) return null;
  try {
    const dateStr = task.due_time
      ? `${task.due_date}T${task.due_time}`
      : `${task.due_date}T23:59:59`;
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The canonical deadline-status function. Used everywhere in the app.
 *
 * Rules:
 * - Completed: user marked it completed, OR it's an AssessPrep task past its deadline.
 * - Overdue: not completed, has a valid deadline, deadline has passed.
 * - Upcoming: not completed, has a valid deadline, deadline is in the future.
 * - Unscheduled: no deadline or invalid deadline.
 */
export function getDeadlineStatus(task: Task, now: Date = new Date()): DeadlineStatus {
  if (task.status === 'completed') return 'completed';

  const deadline = getTaskDeadline(task);
  if (!deadline) return 'unscheduled';

  const isPastDeadline = deadline.getTime() < now.getTime();

  if (isPastDeadline) {
    // AssessPrep tasks auto-complete after their deadline passes.
    if (isAssessPrepTask(task) || (isPenPaperTest(task) && !task.auto_reopened_at)) return 'completed';
    return 'overdue';
  }

  return 'upcoming';
}

/**
 * Whether a task should be auto-completed in the database because it's an
 * AssessPrep task past its deadline. Used to decide if a DB update is needed.
 */
export function shouldAutoCompleteAssessPrep(task: Task, now: Date = new Date()): boolean {
  if (task.status === 'completed') return false;
  const deadline = getTaskDeadline(task);
  if (!deadline) return false;
  return isAssessPrepTask(task) && deadline.getTime() < now.getTime();
}
