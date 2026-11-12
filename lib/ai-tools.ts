'use client';

import { supabase } from '@/lib/supabase/client';
import type { Priority, TaskCategory } from '@/lib/types';

/** One criterion's feedback from the AI grader. */
export interface GradedCriterion {
  name: string;
  band: string;
  evidence: string;
  strengths: string[];
  improvements: string[];
}

export interface GradeResult {
  assessable: boolean;
  /** Whether the student's own rubric was used, or the standard IB criteria. */
  criteriaSource: 'provided' | 'standard';
  summary: string;
  overallBand: string;
  criteria: GradedCriterion[];
  nextSteps: string[];
}

export interface GradeRequest {
  title: string;
  subject: string;
  programme: 'MYP' | 'DP';
  criteria: string;
  work: string;
}

async function callAiTools(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!base || !session) return { status: 401, data: { ok: false, error: 'Please sign in again and retry.' } };

  try {
    const res = await fetch(`${base}/functions/v1/ai-tools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        Apikey: anon ?? '',
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { ok: false, error: 'Could not reach TaskTrack. Check your connection and try again.' } };
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Ask the AI grader for feedback. Uses one of the student's daily AI messages. */
export async function gradeWork(
  request: GradeRequest
): Promise<{ ok: true; result: GradeResult } | { ok: false; error: string; limitReached?: boolean }> {
  const { status, data } = await callAiTools({ action: 'grade', ...request });
  if (status === 404) return { ok: false, error: 'The AI grader isn’t switched on yet. Please try again later.' };
  if (!data.ok || typeof data.result !== 'object' || data.result === null) {
    return { ok: false, error: text(data.error) || 'The AI grader could not finish. Please try again.', limitReached: data.limitReached === true };
  }
  const raw = data.result as Record<string, unknown>;
  const criteria = Array.isArray(raw.criteria)
    ? (raw.criteria as Record<string, unknown>[]).map((c) => ({
        name: text(c?.name) || 'Criterion',
        band: text(c?.band),
        evidence: text(c?.evidence),
        strengths: strings(c?.strengths),
        improvements: strings(c?.improvements),
      }))
    : [];
  return {
    ok: true,
    result: {
      assessable: raw.assessable !== false,
      criteriaSource: raw.criteriaSource === 'provided' ? 'provided' : 'standard',
      summary: text(raw.summary),
      overallBand: text(raw.overallBand),
      criteria,
      nextSteps: strings(raw.nextSteps),
    },
  };
}

// ---- Auto-sorting imported tasks ----

const SORTED_KEY = 'tasktrack:auto-sorted-task-ids';
/** Fired after tasks were sorted, so open pages can refresh their lists. */
export const TASKS_SORTED_EVENT = 'tasktrack:tasks-sorted';

function readSorted(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SORTED_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveSorted(ids: Set<string>) {
  try {
    // Keep the newest 500 so the list cannot grow without bound.
    window.localStorage.setItem(SORTED_KEY, JSON.stringify(Array.from(ids).slice(-500)));
  } catch {
    // Storage blocked: the same tasks may simply be offered again next visit.
  }
}

/**
 * Give unsorted tasks a subject and a priority. Each task is offered to the sorter
 * once per device, so a task the AI could not place is not retried on every page load.
 * Returns how many tasks changed.
 */
export async function autoSortTasks(): Promise<number> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id')
    .is('subject_id', null)
    .eq('is_archived', false)
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(80);
  const already = readSorted();
  const pending = ((tasks ?? []) as { id: string }[]).map((t) => t.id).filter((id) => !already.has(id)).slice(0, 40);
  if (pending.length === 0) return 0;

  const { data } = await callAiTools({ action: 'classify', taskIds: pending });
  if (!data.ok) return 0;
  pending.forEach((id) => already.add(id));
  saveSorted(already);
  const updated = typeof data.updated === 'number' ? data.updated : 0;
  if (updated > 0) window.dispatchEvent(new Event(TASKS_SORTED_EVENT));
  return updated;
}

// ---- "Would you like this graded?" ----

const SUBMISSION_CATEGORIES: TaskCategory[] = ['summative_assessment', 'formative_assessment', 'project', 'presentation', 'homework'];
const SUBMISSION_WORDS = /\b(summative|formative|essay|report|draft|submission|submit|investigation|task\s*\d|criterion|criteria|portfolio|reflection|ia|ee|write[- ]?up|analysis|commentary)\b/i;
const NOT_SUBMISSION = /\b(quiz|test|exam|mock)\b/i;

/** True when a task is something the student writes and hands in, so grading makes sense. */
export function isSubmissionTask(task: { title?: string | null; description?: string | null; category?: string | null; priority?: Priority | string | null } | null | undefined): boolean {
  if (!task?.title) return false;
  const words = `${task.title} ${task.description ?? ''}`;
  if (SUBMISSION_WORDS.test(words)) return true;
  if (NOT_SUBMISSION.test(task.title)) return false;
  return SUBMISSION_CATEGORIES.includes(task.category as TaskCategory) && task.category !== 'homework';
}

// ---- Group study ----

/** Ask the AI to answer the latest question in a group study room. Uses one AI message. */
export async function askGroupAi(groupId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { status, data } = await callAiTools({ action: 'group_ask', groupId });
  if (status === 404 && !data.error) return { ok: false, error: 'The group AI isn’t switched on yet. Please try again later.' };
  if (!data.ok) return { ok: false, error: text(data.error) || 'The AI could not answer. Please try again.' };
  return { ok: true };
}
