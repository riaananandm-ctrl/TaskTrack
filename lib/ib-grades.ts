/**
 * IB grade maths. Pure functions only, so they can be tested and reused.
 *
 * MYP: each subject has criteria A-D marked 0-8. We average the student's last
 * three marks per criterion, add the four averages (out of 32) and convert with
 * the standard MYP 1-7 boundaries. If a criterion has no marks yet, the total is
 * scaled up from the criteria that do have marks, and the grade is flagged as an
 * estimate.
 *
 * DP: each assessment is graded 1-7. The prediction is the rounded average of the
 * last three grades for that subject.
 *
 * These are guides from the student's own marks, not official predictions.
 */

export type Programme = 'MYP' | 'DP';
export type Criterion = 'A' | 'B' | 'C' | 'D';
export const CRITERIA: Criterion[] = ['A', 'B', 'C', 'D'];

/** Short names for MYP criteria are subject-specific, so we show a generic hint. */
export const CRITERION_HINT: Record<Criterion, string> = {
  A: 'usually knowing and understanding',
  B: 'usually investigating or developing',
  C: 'usually communicating or applying',
  D: 'usually thinking critically or reflecting',
};

export interface GradeEntry {
  id: string;
  subject_name: string;
  programme: Programme;
  level: 'SL' | 'HL' | null;
  assessment: string | null;
  criterion: Criterion | null;
  mark: number;
  assessed_on: string; // YYYY-MM-DD
}

/** MYP boundaries: total out of 32 to a 1-7 grade. */
export function mypGradeFromTotal(total: number): number {
  const t = Math.round(total);
  if (t >= 28) return 7;
  if (t >= 24) return 6;
  if (t >= 19) return 5;
  if (t >= 15) return 4;
  if (t >= 10) return 3;
  if (t >= 6) return 2;
  return 1;
}

/** Points needed to reach the next MYP grade boundary, or null at grade 7. */
export function mypPointsToNextGrade(total: number): number | null {
  const lows = [0, 6, 10, 15, 19, 24, 28];
  const t = Math.round(total);
  const next = lows.find((low) => low > t);
  return next === undefined ? null : next - t;
}

function newestFirst(a: GradeEntry, b: GradeEntry): number {
  return b.assessed_on.localeCompare(a.assessed_on) || b.id.localeCompare(a.id);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface MypSummary {
  programme: 'MYP';
  subject: string;
  criteria: Record<Criterion, number | null>;
  total: number;
  estimated: boolean;
  grade: number;
  weakest: Criterion | null;
  toNextGrade: number | null;
}

export interface DpSummary {
  programme: 'DP';
  subject: string;
  level: 'SL' | 'HL' | null;
  predicted: number;
  latest: number;
  trend: 'up' | 'down' | 'flat';
  count: number;
}

export type SubjectSummary = MypSummary | DpSummary;

export function mypSummary(subject: string, entries: GradeEntry[]): MypSummary {
  const criteria = { A: null, B: null, C: null, D: null } as Record<Criterion, number | null>;
  for (const c of CRITERIA) {
    const recent = entries.filter((e) => e.criterion === c).sort(newestFirst).slice(0, 3);
    if (recent.length) criteria[c] = round1(recent.reduce((s, e) => s + e.mark, 0) / recent.length);
  }
  const present = CRITERIA.filter((c) => criteria[c] !== null);
  const sum = present.reduce((s, c) => s + (criteria[c] as number), 0);
  const total = present.length ? round1((sum / present.length) * 4) : 0;
  let weakest: Criterion | null = null;
  for (const c of present) {
    if (weakest === null || (criteria[c] as number) < (criteria[weakest] as number)) weakest = c;
  }
  return {
    programme: 'MYP',
    subject,
    criteria,
    total,
    estimated: present.length > 0 && present.length < 4,
    grade: present.length ? mypGradeFromTotal(total) : 0,
    weakest,
    toNextGrade: present.length ? mypPointsToNextGrade(total) : null,
  };
}

export function dpSummary(subject: string, entries: GradeEntry[]): DpSummary {
  const sorted = [...entries].sort(newestFirst);
  const recent = sorted.slice(0, 3);
  const predicted = recent.length ? Math.round(recent.reduce((s, e) => s + e.mark, 0) / recent.length) : 0;
  const latest = sorted[0]?.mark ?? 0;
  const prev = sorted[1]?.mark;
  const trend = prev === undefined || prev === latest ? 'flat' : latest > prev ? 'up' : 'down';
  const level = sorted.find((e) => e.level)?.level ?? null;
  return { programme: 'DP', subject, level, predicted, latest, trend, count: entries.length };
}

/** One summary per subject (case-insensitive), weakest first. */
export function summarise(entries: GradeEntry[]): SubjectSummary[] {
  const groups = new Map<string, { name: string; programme: Programme; items: GradeEntry[] }>();
  for (const e of entries) {
    const key = `${e.programme}:${e.subject_name.trim().toLowerCase()}`;
    const g = groups.get(key) ?? { name: e.subject_name.trim(), programme: e.programme, items: [] };
    g.items.push(e);
    groups.set(key, g);
  }
  const out: SubjectSummary[] = [];
  for (const g of Array.from(groups.values())) {
    out.push(g.programme === 'MYP' ? mypSummary(g.name, g.items) : dpSummary(g.name, g.items));
  }
  return out.sort((a, b) => gradeOf(a) - gradeOf(b) || a.subject.localeCompare(b.subject));
}

export function gradeOf(s: SubjectSummary): number {
  return s.programme === 'MYP' ? s.grade : s.predicted;
}

/** DP total out of 42 (6 subjects x 7) when exactly six DP subjects have grades. */
export function dpTotal(summaries: SubjectSummary[]): number | null {
  const dp = summaries.filter((s): s is DpSummary => s.programme === 'DP');
  if (dp.length !== 6) return null;
  return dp.reduce((s, d) => s + d.predicted, 0);
}

/** One plain sentence telling the student what to work on next. */
export function focusTip(summaries: SubjectSummary[]): string | null {
  if (!summaries.length) return null;
  const weakest = summaries[0];
  if (weakest.programme === 'MYP') {
    if (!weakest.weakest) return null;
    const avg = weakest.criteria[weakest.weakest];
    const more = weakest.toNextGrade ? ` ${weakest.toNextGrade} more point${weakest.toNextGrade === 1 ? '' : 's'} in total would lift you to a ${weakest.grade + 1}.` : '';
    return `Work on ${weakest.subject} criterion ${weakest.weakest} (${CRITERION_HINT[weakest.weakest]}). You're averaging ${avg}/8 there.${more}`;
  }
  if (weakest.predicted >= 7) return 'Every subject is predicted a 7. Keep it up!';
  return `${weakest.subject} is your lowest at a predicted ${weakest.predicted}. Ask your teacher which skill would move it to a ${weakest.predicted + 1}.`;
}

/**
 * Whether a year group is in the IB Diploma (Grades 11-12 / Years 12-13).
 * Returns null when we can't tell (no year group, or "Other").
 */
export function isDpYear(yearGroup: string | null | undefined): boolean | null {
  if (!yearGroup || yearGroup === 'Other') return null;
  return /DP|Grade 1[12]\b|Year 1[23]\b/.test(yearGroup);
}

// ---------- Honour roll (MYP, 8 subjects) ----------

export type HonourAward = 'chairman' | 'high_honour' | 'honour' | 'merit';

export const HONOUR_LABEL: Record<HonourAward, string> = {
  chairman: 'Chairman’s Roll',
  high_honour: 'High Honour Roll',
  honour: 'Honour Roll',
  merit: 'Merit Roll',
};

/**
 * School honour roll levels, highest first. Each needs a total across all 8 subjects
 * and a lowest-grade floor: any grade below 4 rules out every award, below 5 rules out
 * High Honour and Chairman's, and below 6 rules out Chairman's.
 */
export const HONOUR_LEVELS: { award: HonourAward; total: number; minGrade: number }[] = [
  { award: 'chairman', total: 52, minGrade: 6 },
  { award: 'high_honour', total: 48, minGrade: 5 },
  { award: 'honour', total: 44, minGrade: 4 },
  { award: 'merit', total: 40, minGrade: 4 },
];

export const HONOUR_SUBJECTS = 8;

export interface HonourResult {
  /** Subjects with a grade so far (only the first 8 count). */
  counted: number;
  total: number;
  lowest: number | null;
  /** The award earned, or null. Only set once all 8 subjects have a grade. */
  award: HonourAward | null;
  /** Why a higher award was missed, in one plain sentence. */
  note: string | null;
  /** The next award up and how many more points it needs, if the total is short. */
  next: { award: HonourAward; points: number } | null;
}

/** Works out the honour roll from 1-7 subject grades. */
export function honourRoll(grades: number[]): HonourResult {
  const counted = grades.filter((g) => g > 0).slice(0, HONOUR_SUBJECTS);
  const total = counted.reduce((s, g) => s + g, 0);
  const lowest = counted.length ? Math.min(...counted) : null;
  const complete = counted.length === HONOUR_SUBJECTS;

  let award: HonourAward | null = null;
  let note: string | null = null;
  if (complete && lowest !== null) {
    for (const level of HONOUR_LEVELS) {
      if (total < level.total) continue;
      if (lowest >= level.minGrade) {
        award = level.award;
        break;
      }
      // Total is high enough but a grade is too low: say so, then try the level below.
      note ??= lowest < 4
        ? `A grade below 4 means no honour roll this time, even with ${total} points.`
        : `You have the points for the ${HONOUR_LABEL[level.award]}, but it needs every grade at ${level.minGrade} or above.`;
    }
  }

  const reachable = HONOUR_LEVELS.filter((l) => l.total > total).pop();
  const next = complete && reachable && (!award || HONOUR_LEVELS.findIndex((l) => l.award === award) > HONOUR_LEVELS.indexOf(reachable))
    ? { award: reachable.award, points: reachable.total - total }
    : null;

  return { counted: counted.length, total, lowest, award, note, next };
}
