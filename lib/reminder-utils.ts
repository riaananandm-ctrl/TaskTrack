import { format, addDays, setHours, setMinutes, startOfDay } from 'date-fns';

// Standard offsets (in days before the due date) used to suggest reminders.
export const STANDARD_OFFSETS_DAYS = [7, 3, 1];

export interface ReminderTimeSuggestion {
  date: string;
  time: string;
}

export function combineDateTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

export function validateReminderTime(dateStr: string, timeStr: string, from: Date = new Date()): string | null {
  const dt = combineDateTime(dateStr, timeStr);
  if (!dt) return 'Please choose a valid date and time.';
  if (dt.getTime() <= from.getTime()) {
    return 'Reminder time must be in the future. Please choose a later date or time.';
  }
  return null;
}

function toSuggestion(dt: Date): ReminderTimeSuggestion {
  return { date: format(dt, 'yyyy-MM-dd'), time: format(dt, 'HH:mm') };
}

/**
 * Produce `count` reminder times spread out before the task's due date. If the
 * due date is too soon for the standard offsets, the suggestions are compressed
 * proportionally into the remaining time. No suggestion is ever returned at or
 * before the current moment.
 */
export function suggestReminderTimes(
  dueDate: string | null,
  dueTime: string | null,
  count: number = 3,
  from: Date = new Date()
): ReminderTimeSuggestion[] {
  const earliest = from.getTime() + 60 * 1000;
  const due = dueDate ? combineDateTime(dueDate, dueTime || '23:59') : null;

  // No due date: one per day at 09:00 for the next few days.
  if (!due) {
    return Array.from({ length: count }, (_, i) => {
      const day = addDays(from, i + 1);
      const dt = setMinutes(setHours(startOfDay(day), 9), 0);
      return toSuggestion(dt.getTime() < earliest ? new Date(earliest) : dt);
    });
  }

  const dueMs = due.getTime();
  const available = dueMs - earliest;

  // Due date is at or behind the earliest valid moment: stack suggestions
  // forward from now in short increments so none lands in the past.
  if (available <= 0) {
    return Array.from({ length: count }, (_, i) =>
      toSuggestion(new Date(earliest + i * 15 * 60 * 1000))
    );
  }

  const standardFit = STANDARD_OFFSETS_DAYS.slice(0, count).every(
    (days) => dueMs - days * 24 * 60 * 60 * 1000 >= earliest
  );

  if (standardFit) {
    return STANDARD_OFFSETS_DAYS.slice(0, count).map((days) =>
      toSuggestion(new Date(dueMs - days * 24 * 60 * 60 * 1000))
    );
  }

  const spacing = available / (count + 1);
  return Array.from({ length: count }, (_, i) => toSuggestion(new Date(earliest + spacing * (i + 1))));
}
