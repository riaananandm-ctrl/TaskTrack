'use client';

import { supabase } from '@/lib/supabase/client';

export interface GamificationStats {
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  badges: string[];
}

export interface OnboardingProgress {
  step_managebac_visited: boolean;
  step_managebac_connected: boolean;
  step_ai_session_created: boolean;
  step_first_task_added: boolean;
  step_first_task_completed: boolean;
  step_first_focus_session: boolean;
  step_onboarding_completed: boolean;
}

export const XP_RULES = {
  onboarding_completed: 50,
  managebac_connected: 30,
  first_task_imported_from_managebac: 20,
  first_ai_study_session: 30,
  task_added: 10,
  task_completed: 20,
  focus_session_25m: 30,
  planned_day: 10,
} as const;

export const BADGE_KEYS = {
  managebac_connected: 'managebac_connected',
  first_ai_study_session: 'first_ai_study_session',
  first_task_added: 'first_task_added',
  first_task_completed: 'first_task_completed',
  first_focus_session: 'first_focus_session',
  onboarding_completed: 'onboarding_completed',
} as const;

export const BADGE_LABELS: Record<string, string> = {
  managebac_connected: 'ManageBac Connected',
  first_ai_study_session: 'First AI Study Plan',
  first_task_added: 'First Task Added',
  first_task_completed: 'First Task Completed',
  first_focus_session: 'First Focus Session',
  onboarding_completed: 'Onboarding Complete',
};

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp) / 5) + 1);
}

export function xpForNextLevel(currentXp: number): number {
  const level = levelForXp(currentXp);
  const nextLevelXp = Math.pow((level - 1) * 5, 2);
  const targetXp = Math.pow(level * 5, 2);
  return Math.max(0, targetXp - currentXp);
}

export async function awardXp(amount: number, reason: string, badgeKey?: string): Promise<void> {
  const { error } = await supabase.rpc('award_xp', {
    p_amount: amount,
    p_reason: reason,
    p_badge_key: badgeKey ?? null,
  });
  if (error) throw error;
}

export async function recordMetric(eventName: string, eventData?: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('record_metric', {
    p_event_name: eventName,
    p_event_data: eventData ?? null,
  });
  if (error) throw error;
}

export async function fetchGamificationStats(): Promise<GamificationStats> {
  const [xpRes, streaksRes, badgesRes] = await Promise.all([
    supabase.from('user_xp').select('total_xp, level').maybeSingle(),
    supabase.from('user_streaks').select('current_streak, longest_streak').maybeSingle(),
    supabase.from('user_badges').select('badge_key'),
  ]);

  return {
    totalXp: xpRes.data?.total_xp ?? 0,
    level: xpRes.data?.level ?? 1,
    currentStreak: streaksRes.data?.current_streak ?? 0,
    longestStreak: streaksRes.data?.longest_streak ?? 0,
    badges: (badgesRes.data ?? []).map((b: { badge_key: string }) => b.badge_key),
  };
}

export async function fetchOnboardingProgress(): Promise<OnboardingProgress | null> {
  const { data, error } = await supabase
    .from('onboarding_progress')
    .select('*')
    .maybeSingle();
  if (error) return null;
  return data as OnboardingProgress | null;
}

export async function upsertOnboardingProgress(
  updates: Partial<OnboardingProgress>
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from('onboarding_progress')
    .upsert(
      { user_id: user.id, ...updates, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}

export async function completeStep(
  stepKey: keyof OnboardingProgress,
  xpAmount: number,
  reason: string,
  badgeKey?: string
): Promise<void> {
  await upsertOnboardingProgress({ [stepKey]: true } as Partial<OnboardingProgress>);
  await awardXp(xpAmount, reason, badgeKey);
  await recordMetric(reason, { step: stepKey });
}
