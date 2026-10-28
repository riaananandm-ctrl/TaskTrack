import { Task, Priority, TaskStatus } from '@/lib/types';
import { format, isToday, isTomorrow, parseISO, differenceInCalendarDays } from 'date-fns';
import { getDeadlineStatus } from '@/lib/deadline-status';

export function getTaskStatusColor(task: Task): string {
  const status = getDeadlineStatus(task);
  switch (status) {
    case 'completed': return '#16A34A';
    case 'overdue': return '#DC2626';
    case 'upcoming': return '#2563EB';
    case 'unscheduled': return '#64748B';
  }
}

export function getDueDateLabel(task: Task): string {
  if (!task.due_date) return 'No due date';
  const due = parseISO(task.due_date);
  if (isToday(due)) return task.due_time ? `Today at ${task.due_time}` : 'Today';
  if (isTomorrow(due)) return task.due_time ? `Tomorrow at ${task.due_time}` : 'Tomorrow';
  const diff = differenceInCalendarDays(due, new Date());
  if (diff < 0 && diff >= -7) return `${Math.abs(diff)} days overdue`;
  if (diff > 0 && diff <= 7) return format(due, 'EEEE');
  return format(due, 'MMM d');
}

export function isOverdue(task: Task): boolean {
  if (task.status === 'completed' || task.is_archived) return false;
  return getDeadlineStatus(task) === 'overdue';
}

export function isDueToday(task: Task): boolean {
  if (task.status === 'completed' || task.is_archived) return false;
  if (!task.due_date) return false;
  return isToday(parseISO(task.due_date));
}

export function isDueSoon(task: Task, days = 7): boolean {
  if (task.status === 'completed' || task.is_archived) return false;
  if (!task.due_date) return false;
  const due = parseISO(task.due_date);
  const diff = differenceInCalendarDays(due, new Date());
  return diff >= 0 && diff <= days;
}

export function formatDueDate(dateStr: string | null, timeStr: string | null): string {
  if (!dateStr) return 'No due date';
  const date = parseISO(dateStr);
  let label = format(date, 'MMM d, yyyy');
  if (timeStr) label += ` at ${timeStr}`;
  return label;
}

export function getPriorityBadgeClass(priority: Priority): string {
  switch (priority) {
    case 'urgent': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'high': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
    case 'medium': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'low': return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  }
}

export function getStatusBadgeClass(status: TaskStatus): string {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'in_progress': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'not_started': return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    case 'archived': return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500';
  }
}
