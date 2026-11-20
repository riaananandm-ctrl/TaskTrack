'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';

/**
 * AI credits. Each plan gets a monthly allowance (refilled on the 1st, UTC) and each
 * AI action costs credits by how much work it is. The server charges them; these
 * numbers are only for showing students what things cost.
 */
export const CREDIT_COSTS = {
  chat: 1,
  explain: 1,
  examples: 1,
  practice: 1,
  quiz: 2,
  flashcards: 2,
  plan: 2,
  slides: 3,
  grade: 5,
  group: 1,
} as const;

export const MONTHLY_CREDITS = { free: 60, pro: 2000 } as const;

export const CREDITS_CHANGED_EVENT = 'tasktrack:credits-changed';

export interface AiCredits {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string | null;
}

/** Tell any credit badge on the page to refresh after an AI action. */
export function announceCreditsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
}

export function useAiCredits() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<AiCredits | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.rpc('get_ai_credits');
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return;
    setCredits({
      used: row.used ?? 0,
      limit: row.credit_limit ?? 0,
      remaining: row.remaining ?? 0,
      resetsAt: row.resets_at ?? null,
    });
  }, [user]);

  useEffect(() => {
    load();
    window.addEventListener(CREDITS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CREDITS_CHANGED_EVENT, load);
  }, [load]);

  return { credits, reload: load };
}

/** "1 Dec" style date for when credits refill. */
export function refillDate(iso: string | null): string {
  if (!iso) return 'the 1st';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
