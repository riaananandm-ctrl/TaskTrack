/**
 * Helpers for learning from a student's subject corrections.
 * KEEP IN SYNC with the copy in supabase/functions/ai-tools/index.ts.
 */

/** Words that say what kind of task it is, not which class set it. */
const GENERIC_WORDS = new Set([
  'task', 'tasks', 'summative', 'formative', 'assessment', 'assessments', 'sa', 'fa', 'test', 'quiz',
  'homework', 'hw', 'classwork', 'cw', 'criterion', 'criteria', 'cr', 'unit', 'project', 'assignment',
  'final', 'draft', 'submission', 'activity', 'worksheet', 'practice', 'myp', 'dp', 'the', 'a', 'an',
  'and', 'of', 'for', 'to', 'in', 'on', 'b', 'c', 'd', 'i', 'ii', 'iii', 'iv',
]);

/**
 * The part of a title that names a series, e.g. "CAS Task- Our Planet" -> "cas".
 * Only the text before a separator (-, :, |, –, —) counts, and generic words are dropped,
 * so "Summative Assessment 2" gives null rather than matching every summative.
 */
export function titleSeriesKey(title: string): string | null {
  const match = /^(.{2,40}?)\s*[-:|–—]/.exec(title.trim());
  if (!match) return null;
  const words = match[1]
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !GENERIC_WORDS.has(w) && !/^\d+$/.test(w));
  if (words.length === 0) return null;
  const key = words.join(' ');
  return key.length >= 2 ? key : null;
}

/** Tasks like CAS or Service as Action can be set by any teacher, so their topic says nothing about the subject. */
export const CROSS_SUBJECT_TASK = /\b(cas|service as action|s\s*&\s*a|community service|advisory|homeroom|assembly|house (event|activity)|personal project|interdisciplinary|idu)\b/i;
