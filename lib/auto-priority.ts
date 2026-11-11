import type { Priority } from '@/lib/types';

/**
 * Keyword rules that set a task's priority from its title. Checked from highest to
 * lowest, so a title that matches several rules gets the highest one.
 *
 * KEEP IN SYNC with the copies in supabase/functions/sync-managebac-calendar/index.ts
 * and supabase/functions/managebac-connect/index.ts (edge functions can't import from lib/).
 */
export const AUTO_PRIORITY_RULES: { pattern: RegExp; priority: Priority; keyword: string }[] = [
  { pattern: /\bsummative\b/i, priority: 'urgent', keyword: 'Summative' },
  { pattern: /\bformative\b/i, priority: 'high', keyword: 'Formative' },
  // "Task 3", "task3", "TASK 3" — but not "Task 30" or "Task 13".
  { pattern: /\btask\s*3(?!\d)/i, priority: 'medium', keyword: 'Task 3' },
];

/** The rule a title matches, or null when no keyword applies. */
export function matchAutoPriority(title: string | null | undefined) {
  if (!title) return null;
  return AUTO_PRIORITY_RULES.find((rule) => rule.pattern.test(title)) ?? null;
}

/** Priority for a title, falling back to `fallback` when no keyword applies. */
export function autoPriority(title: string | null | undefined, fallback: Priority = 'medium'): Priority {
  return matchAutoPriority(title)?.priority ?? fallback;
}
