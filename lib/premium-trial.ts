import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { isPaidPlan, resolvePlan } from '@/lib/entitlements';
import { announceCreditsChanged } from '@/lib/ai-credits';
import { recordMetric } from '@/lib/gamification';

export const TRIAL_DAYS = 7;

const TRIAL_ERRORS: Record<string, string> = {
  used: 'You have already used your free week.',
  already_paid: 'You already have a paid plan.',
  auth: 'Please sign in again and retry.',
};

/**
 * One free week of Premium per account. `eligible` is null while checking.
 * Starting it switches the plan on straight away (no payment, nothing renews).
 */
export function usePremiumTrial() {
  const { user, profile, refreshProfile } = useAuth();
  const paid = isPaidPlan(resolvePlan(profile));
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!user) return;
    if (paid) {
      setEligible(false);
      return;
    }
    supabase
      .from('premium_trials')
      .select('user_id')
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (alive) setEligible(!e && !data);
      });
    return () => {
      alive = false;
    };
  }, [user, paid]);

  const start = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('start_premium_trial');
    setBusy(false);
    const result = data as { ok?: boolean; error?: string } | null;
    if (e || !result?.ok) {
      setError(TRIAL_ERRORS[result?.error ?? ''] ?? 'Could not start the free week. Please try again.');
      if (result?.error === 'used' || result?.error === 'already_paid') setEligible(false);
      return false;
    }
    setEligible(false);
    await refreshProfile();
    announceCreditsChanged();
    return true;
  }, [refreshProfile]);

  return { eligible, busy, error, start };
}

/** Log that an upgrade offer was shown (for the signup-to-payment funnel). Never throws. */
export function logUpgradeViewed(source: string): void {
  recordMetric('upgrade_viewed', { source }).catch(() => {});
}
