import { supabase } from '@/lib/supabase/client';
import { validSuggestions, type CoachSuggestion } from '@/lib/rewrite-coach-apply';

export { applySuggestions, segments, validSuggestions, type CoachSuggestion } from '@/lib/rewrite-coach-apply';

export type CoachGoal = 'clarity' | 'concise' | 'grammar' | 'structure' | 'tone';
export type CoachTone = 'simple' | 'confident' | 'formal' | 'friendly';

export interface TaskDraft {
  id: string;
  task_id: string;
  original_text: string;
  revised_text: string;
  permission_confirmed_at: string;
  updated_at: string;
}

export const COACH_MIN_WORDS = 30;
export const COACH_MAX_WORDS = 1500;

export function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export async function getCoachAccess(): Promise<{ used: number; limit: number; premium: boolean }> {
  const { data, error } = await supabase.rpc('get_coach_access');
  const d = (error ? null : data) as Record<string, unknown> | null;
  return {
    used: typeof d?.used === 'number' ? d.used : 0,
    limit: typeof d?.limit === 'number' ? d.limit : 5,
    premium: d?.premium === true,
  };
}

export async function requestSuggestions(input: {
  taskId: string;
  text: string;
  goal: CoachGoal;
  tone?: CoachTone;
}): Promise<
  | { ok: true; suggestions: CoachSuggestion[]; notes: string[] }
  | { ok: false; error: string; reason?: string }
> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { data: { session } } = await supabase.auth.getSession();
  if (!base || !session) return { ok: false, error: 'Please sign in again and retry.' };
  try {
    const res = await fetch(`${base}/functions/v1/rewrite-coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, Apikey: anon ?? '' },
      body: JSON.stringify({ ...input, confirmed: true }),
    });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!d.ok || !Array.isArray(d.suggestions)) {
      return {
        ok: false,
        error: typeof d.error === 'string' ? d.error : 'Rewrite Coach couldn’t run right now. Please try again.',
        reason: typeof d.reason === 'string' ? d.reason : undefined,
      };
    }
    return {
      ok: true,
      suggestions: validSuggestions(input.text, d.suggestions as CoachSuggestion[]),
      notes: Array.isArray(d.notes) ? (d.notes as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return { ok: false, error: 'Could not reach TaskTrack. Check your connection and try again.' };
  }
}

export async function loadDraft(taskId: string): Promise<TaskDraft | null> {
  const { data } = await supabase
    .from('task_drafts')
    .select('id, task_id, original_text, revised_text, permission_confirmed_at, updated_at')
    .eq('task_id', taskId)
    .maybeSingle();
  return (data as TaskDraft | null) ?? null;
}

/** First save stores the original and the revision; later saves only change the revision. */
export async function saveDraft(taskId: string, existing: TaskDraft | null, original: string, revised: string): Promise<TaskDraft | null> {
  if (existing) {
    const { data, error } = await supabase
      .from('task_drafts')
      .update({ revised_text: revised })
      .eq('id', existing.id)
      .select('id, task_id, original_text, revised_text, permission_confirmed_at, updated_at')
      .single();
    return error ? null : (data as TaskDraft);
  }
  const { data, error } = await supabase
    .from('task_drafts')
    .insert({ task_id: taskId, original_text: original, revised_text: revised, permission_confirmed_at: new Date().toISOString() })
    .select('id, task_id, original_text, revised_text, permission_confirmed_at, updated_at')
    .single();
  return error ? null : (data as TaskDraft);
}

export async function deleteDraft(id: string): Promise<boolean> {
  const { error } = await supabase.from('task_drafts').delete().eq('id', id);
  return !error;
}
