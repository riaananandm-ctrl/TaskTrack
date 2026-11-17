'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';

/**
 * Terms, age and parental consent.
 *
 * Every student agrees to the Terms and Privacy Policy and says whether they are 18+.
 * Under-18s (children under India's DPDP Act) need a parent or guardian to confirm
 * through a one-time link before they can use Group Study. Writes go through database
 * functions only; students can read their own row but can't change it directly.
 */

/** Must match tasktrack_terms_version() in the database. */
export const TERMS_VERSION = '2026-11-13';

export type AgeBand = 'adult' | 'minor';

export interface Consent {
  terms_accepted_at: string | null;
  terms_version: string | null;
  age_band: AgeBand | null;
  parent_name: string | null;
  parent_consent_at: string | null;
  parent_token_expires_at: string | null;
  age_verified_at: string | null;
  age_check_result: AgeBand | null;
  age_check_attempts: number | null;
  age_check_window_start: string | null;
}

export const CONSENT_CHANGED_EVENT = 'tasktrack:consent-changed';

export function needsTerms(c: Consent | null): boolean {
  return !c || !c.terms_accepted_at || c.terms_version !== TERMS_VERSION;
}

/** Says 18+ but hasn't passed the face age check yet (and has no parent OK instead). */
export function needsAgeCheck(c: Consent | null): boolean {
  return !!c && c.age_band === 'adult' && !c.age_verified_at && !c.parent_consent_at;
}

/** Scan tries left today (3 per rolling day). */
export function ageChecksLeft(c: Consent | null): number {
  if (!c?.age_check_window_start) return 3;
  const windowOpen = Date.now() - new Date(c.age_check_window_start).getTime() < 24 * 60 * 60 * 1000;
  return windowOpen ? Math.max(0, 3 - (c.age_check_attempts ?? 0)) : 3;
}

export function needsParent(c: Consent | null): boolean {
  return !!c && c.age_band === 'minor' && !c.parent_consent_at;
}

export function useConsent() {
  const { user } = useAuth();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [loading, setLoading] = useState(true);
  // If consent can't be read at all (for example the database is mid-update), don't
  // lock students out of their planner; the server still enforces Group Study rules.
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('user_consents')
      .select('terms_accepted_at, terms_version, age_band, parent_name, parent_consent_at, parent_token_expires_at, age_verified_at, age_check_result, age_check_attempts, age_check_window_start')
      .eq('user_id', user.id)
      .maybeSingle();
    setUnavailable(!!error);
    setConsent((data as Consent | null) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener(CONSENT_CHANGED_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  return { consent, loading, unavailable, reload: load };
}

function announce() {
  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}

export async function acceptTerms(ageBand: AgeBand): Promise<string | null> {
  const { error } = await supabase.rpc('tasktrack_accept_terms', { p_age_band: ageBand });
  if (error) return 'We couldn’t save that. Please try again.';
  announce();
  return null;
}

/** Saves the result of an on-device face age estimate. Only 'adult' or 'minor' is stored. */
export async function recordAgeCheck(estimatedAge: number): Promise<{ result: AgeBand } | { error: string }> {
  const { data, error } = await supabase.rpc('tasktrack_record_age_check', {
    p_consented: true,
    p_estimated_age: estimatedAge,
  });
  if (error) {
    return {
      error: error.message.includes('too_many_attempts')
        ? 'That’s 3 tries today. Try again tomorrow, or continue as under 18.'
        : 'We couldn’t save the result. Please try again.',
    };
  }
  announce();
  return { result: data === 'adult' ? 'adult' : 'minor' };
}

/** A fresh link for a parent or guardian. Valid for 14 days; making a new one replaces the old. */
export async function createParentLink(): Promise<{ url: string } | { error: string }> {
  const { data, error } = await supabase.rpc('tasktrack_create_parent_link');
  if (error || typeof data !== 'string') return { error: 'We couldn’t make the link. Please try again.' };
  announce();
  return { url: `${window.location.origin}/parent-consent?t=${data}` };
}

export async function parentLinkInfo(token: string) {
  const { data, error } = await supabase.rpc('tasktrack_parent_link_info', { p_token: token });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return { firstName: null as string | null, valid: false, alreadyConfirmed: false };
  return {
    firstName: (row.student_first_name as string | null) ?? null,
    valid: !!row.valid,
    alreadyConfirmed: !!row.already_confirmed,
  };
}

export async function confirmParentConsent(token: string, parentName: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('tasktrack_confirm_parent_consent', {
    p_token: token,
    p_parent_name: parentName,
  });
  if (error) {
    return error.message.includes('name_required') ? 'Please type your full name.' : 'Something went wrong. Please try again.';
  }
  if (!data) return 'This link has expired or was already used. Ask your child to make a new one in TaskTrack.';
  return null;
}
