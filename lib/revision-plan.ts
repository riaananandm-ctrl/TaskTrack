/**
 * Builds a revision timetable backwards from exam dates. Pure, so it's testable.
 *
 * Each exam gets sessions at spaced gaps before it (1, 2, 4, 7, 11, 16, 22, 29,
 * 37 and 46 days before), so topics come back just as they start to fade. Days
 * are capped (3 sessions by default across all exams); when a day is full the
 * session moves one day earlier until there is room. Sessions never land before
 * today or on/after the exam day.
 */

export interface PlanExam {
  id: string;
  subject_name: string;
  paper?: string | null;
  exam_date: string; // YYYY-MM-DD
}

export interface PlannedSession {
  exam_id: string;
  session_date: string; // YYYY-MM-DD
  focus: string;
  minutes: number;
}

export const OFFSETS = [1, 2, 4, 7, 11, 16, 22, 29, 37, 46];

const EARLY_FOCUS = [
  'Make a one-page summary of the topics',
  'Active recall: flashcards on key terms and formulas',
  'Practice questions on your weakest topic',
  'Go over mistakes from earlier practice',
];

export function focusFor(offset: number, index: number): { focus: string; minutes: number } {
  if (offset === 1) return { focus: 'Light review: summary sheet and flashcards, then rest', minutes: 30 };
  if (offset === 2) return { focus: 'Timed past paper under exam conditions', minutes: 90 };
  if (offset === 4) return { focus: 'Mark a past paper and redo every mistake', minutes: 60 };
  return { focus: EARLY_FOCUS[index % EARLY_FOCUS.length], minutes: 45 };
}

/** YYYY-MM-DD plus n days (n may be negative), in UTC so time zones don't shift it. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function buildRevisionPlan(
  exams: PlanExam[],
  today: string,
  opts: { maxPerDay?: number; busy?: Record<string, number> } = {},
): PlannedSession[] {
  const maxPerDay = opts.maxPerDay ?? 3;
  const perDay: Record<string, number> = { ...(opts.busy ?? {}) };
  const out: PlannedSession[] = [];
  const upcoming = exams.filter((e) => e.exam_date > today).sort((a, b) => a.exam_date.localeCompare(b.exam_date));

  for (const exam of upcoming) {
    const label = exam.paper ? `${exam.subject_name} ${exam.paper}` : exam.subject_name;
    OFFSETS.forEach((offset, i) => {
      let day = addDays(exam.exam_date, -offset);
      if (day < today) return;
      while (day >= today && (perDay[day] ?? 0) >= maxPerDay) day = addDays(day, -1);
      if (day < today) return;
      // Don't stack two sessions for the same exam on one day.
      if (out.some((s) => s.exam_id === exam.id && s.session_date === day)) return;
      perDay[day] = (perDay[day] ?? 0) + 1;
      const { focus, minutes } = focusFor(offset, i);
      out.push({ exam_id: exam.id, session_date: day, focus: `${label}: ${focus}`.slice(0, 200), minutes });
    });
  }
  return out.sort((a, b) => a.session_date.localeCompare(b.session_date));
}
