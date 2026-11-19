/**
 * "I'm done" in the study chat: when a student finishes a ManageBac task they hand in
 * online, TaskTrack points them at ManageBac to submit it. These checks are shared
 * by the chat panel and (copied into) the managebac-submit-link function.
 */

/**
 * A short note that the work is finished ("done", "I'm finished!", "completed it"),
 * not a question about finishing and not "not done yet".
 */
export function saysWorkIsDone(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 80 || t.includes('?')) return false;
  if (/\b(not|almost|nearly|never|until|when|if|how|yet|didn'?t|haven'?t|isn'?t|wasn'?t|aren'?t|can'?t)\b/.test(t)) return false;
  return /\b(done|finished|finish(ed)? it|completed?|wrapped up|all set)\b/.test(t);
}

const SUBMIT_WORDS = /\b(submit|submission|upload|hand(ed)? in|turn(ed)? in|add the (image|document|file|work))/i;
const IN_CLASS_WORDS = /\b(test|quiz|exam|examination|will be conducted|in class|oral|viva|presentation day)\b/i;
const IN_CLASS_CATEGORIES = new Set(['quiz', 'test', 'final_exam', 'mock_exam', 'presentation']);

/** A ManageBac task the student hands in online, not a test or an in-class assessment. */
export function isSubmissionTask(task: {
  external_source?: string | null;
  external_uid?: string | null;
  title?: string | null;
  description?: string | null;
  category?: string | null;
}): boolean {
  if (task.external_source !== 'managebac_calendar' || !task.external_uid) return false;
  if (task.category && IN_CLASS_CATEGORIES.has(task.category)) return false;
  const text = `${task.title ?? ''} ${task.description ?? ''}`;
  if (SUBMIT_WORDS.test(text)) return true;
  return !IN_CLASS_WORDS.test(text);
}
