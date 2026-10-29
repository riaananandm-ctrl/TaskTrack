import { Task, WeeklyPlan } from '@/lib/types';
import { getTaskDeadline } from '@/lib/deadline-status';

/**
 * Workload engine: compares the work a student still has to do against the time
 * they actually have, per day, up to each deadline. Pure functions only — no
 * database access — so the numbers can be unit-tested and reused by any screen.
 *
 * Estimates are advisory only. They are never presented as guarantees.
 */

/** Default available minutes per weekday before the student saves their own. */
export const DEFAULT_AVAILABLE_MINUTES = 360;

export interface DayAvailability {
  /** 0=Sunday..6=Saturday (JS getDay()) */
  weekday: number;
  availableMinutes: number;
  isUnavailable: boolean;
}

export interface WorkloadDay {
  date: string; // yyyy-MM-dd
  weekday: number;
  /** Minutes the student has that day (0 when marked unavailable). */
  availableMinutes: number;
  /** Minutes of study blocks already planned that day. */
  plannedMinutes: number;
  /** Minutes of unplanned work that land on this day by deadline pressure. */
  requiredMinutes: number;
  /** available - planned - required (negative means overcommitted). */
  slackMinutes: number;
  /** Deadlines falling on this day, with their remaining effort. */
  deadlines: Array<{ taskId: string; title: string; remainingMinutes: number }>;
}

export interface WorkloadWarning {
  date: string;
  kind: 'overcommitted' | 'insufficient_time_before_deadline' | 'past_due_unfinished';
  message: string;
  taskIds: string[];
}

/** Effective remaining effort for a task: remaining_minutes, else estimate, else a neutral 30. */
export function remainingMinutesFor(task: Pick<Task, 'estimated_minutes' | 'remaining_minutes' | 'status'>): number {
  if (task.status === 'completed') return 0;
  if (task.remaining_minutes != null) return Math.max(0, task.remaining_minutes);
  if (task.estimated_minutes != null) return Math.max(0, task.estimated_minutes);
  return 30;
}

/** Planned minutes for one day, using explicit times when present. */
export function plannedMinutesForDay(plans: WeeklyPlan[], dateStr: string): number {
  return plans
    .filter((p) => p.planned_date === dateStr)
    .reduce((total, plan) => {
      if (plan.start_time && plan.end_time) {
        const [sh, sm] = plan.start_time.split(':').map(Number);
        const [eh, em] = plan.end_time.split(':').map(Number);
        return total + Math.max(0, eh * 60 + em - (sh * 60 + sm));
      }
      return total + (plan.task?.estimated_minutes || 30);
    }, 0);
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Build the day-by-day workload picture for a date range.
 *
 * Unplanned, incomplete tasks with a deadline are attributed to the day their
 * work must be finished by (the deadline day itself). Planned blocks count on
 * the day they are scheduled. The two never double-count: planned work is not
 * re-attributed to deadlines.
 */
export function buildWorkloadDays(
  from: Date,
  to: Date,
  tasks: Task[],
  plans: WeeklyPlan[],
  availability: DayAvailability[],
  now: Date = new Date()
): WorkloadDay[] {
  const byWeekday = new Map<number, DayAvailability>();
  for (const a of availability) byWeekday.set(a.weekday, a);

  const days: WorkloadDay[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const dateStr = toDateStr(cursor);
    const weekday = cursor.getDay();
    const saved = byWeekday.get(weekday);
    const availableMinutes = saved?.isUnavailable ? 0 : saved?.availableMinutes ?? DEFAULT_AVAILABLE_MINUTES;
    days.push({
      date: dateStr,
      weekday,
      availableMinutes,
      plannedMinutes: 0,
      requiredMinutes: 0,
      slackMinutes: 0,
      deadlines: [],
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  const byDate = new Map(days.map((d) => [d.date, d]));

  // Planned blocks: counted once, on the day scheduled.
  for (const plan of plans) {
    const day = byDate.get(plan.planned_date);
    if (!day) continue;
    if (plan.start_time && plan.end_time) {
      const [sh, sm] = plan.start_time.split(':').map(Number);
      const [eh, em] = plan.end_time.split(':').map(Number);
      day.plannedMinutes += Math.max(0, eh * 60 + em - (sh * 60 + sm));
    } else {
      day.plannedMinutes += plan.task?.estimated_minutes || 30;
    }
  }

  // Unplanned, unfinished work with a deadline: attributed to its deadline day.
  const plannedTaskIds = new Set(plans.map((p) => p.task_id));
  for (const task of tasks) {
    if (task.status === 'completed' || task.is_archived) continue;
    if (plannedTaskIds.has(task.id)) continue;
    const deadline = getTaskDeadline(task);
    if (!deadline || deadline < now) continue;
    const dateStr = toDateStr(deadline);
    const day = byDate.get(dateStr);
    if (!day) continue;
    const remaining = remainingMinutesFor(task);
    day.requiredMinutes += remaining;
    day.deadlines.push({ taskId: task.id, title: task.title, remainingMinutes: remaining });
  }

  for (const day of days) {
    day.slackMinutes = day.availableMinutes - day.plannedMinutes - day.requiredMinutes;
  }
  return days;
}

/**
 * Warnings derived from the workload picture. Every warning states its
 * assumptions (how much time was assumed available and how much work was
 * counted) so the student can judge the advice rather than trust it blindly.
 */
export function buildWorkloadWarnings(days: WorkloadDay[]): WorkloadWarning[] {
  const warnings: WorkloadWarning[] = [];
  for (const day of days) {
    if (day.requiredMinutes + day.plannedMinutes > day.availableMinutes && day.availableMinutes >= 0) {
      if (day.deadlines.length > 0) {
        const needed = day.plannedMinutes + day.requiredMinutes;
        warnings.push({
          date: day.date,
          kind: day.availableMinutes === 0 ? 'insufficient_time_before_deadline' : 'overcommitted',
          message:
            day.availableMinutes === 0
              ? `${day.deadlines.length} deadline${day.deadlines.length === 1 ? '' : 's'} on this day, but you marked it unavailable. You may need to work earlier.`
              : `Planned ${day.plannedMinutes}m plus ${day.requiredMinutes}m of unplanned work needs ${needed}m, but only ${day.availableMinutes}m is available on this day.`,
          taskIds: day.deadlines.map((d) => d.taskId),
        });
      } else if (day.plannedMinutes > day.availableMinutes) {
        warnings.push({
          date: day.date,
          kind: 'overcommitted',
          message: `Planned study blocks total ${day.plannedMinutes}m, but only ${day.availableMinutes}m is available on this day.`,
          taskIds: [],
        });
      }
    }
  }
  return warnings;
}
