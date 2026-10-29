'use client';

import { supabase } from '@/lib/supabase/client';

/**
 * Quiz attempts are stored when a student finishes a quiz, so scores and weak
 * topics survive reloads and can drive real revision advice later. Saving is
 * always best-effort from the caller's point of view: a storage failure must
 * never break the quiz view that is already on screen.
 */

export interface QuizAnswerRecord {
  question: string;
  chosen: string;
  chosenIndex: number;
  correct: boolean;
}

export interface QuizAttempt {
  id: string;
  session_id: string | null;
  task_id: string | null;
  score: number;
  total: number;
  answers: QuizAnswerRecord[];
  weak_topics: string[];
  attempted_at: string;
}

/** The result a finished quiz reports back, ready to persist. */
export interface QuizResult {
  score: number;
  total: number;
  answers: QuizAnswerRecord[];
  weakTopics: string[];
}

export async function saveQuizAttempt(params: {
  sessionId: string;
  taskId: string | null;
  result: QuizResult;
}): Promise<void> {
  const { error } = await supabase.from('quiz_attempts').insert({
    session_id: params.sessionId,
    task_id: params.taskId,
    score: params.result.score,
    total: params.result.total,
    answers: params.result.answers,
    weak_topics: params.result.weakTopics,
  });
  if (error) throw error;
}

/** Most recent attempts, newest first, optionally narrowed to one task. */
export async function listQuizAttempts(params: {
  taskId?: string;
  limit?: number;
} = {}): Promise<QuizAttempt[]> {
  let query = supabase
    .from('quiz_attempts')
    .select('id, session_id, task_id, score, total, answers, weak_topics, attempted_at')
    .order('attempted_at', { ascending: false })
    .limit(params.limit ?? 5);
  if (params.taskId) query = query.eq('task_id', params.taskId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => {
    const answers = Array.isArray(row.answers) ? row.answers : [];
    const weak = Array.isArray(row.weak_topics) ? row.weak_topics : [];
    return {
      ...row,
      answers: answers as QuizAnswerRecord[],
      weak_topics: weak.filter((t): t is string => typeof t === 'string'),
    };
  });
}
