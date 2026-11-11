'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';

const SESSION_KEY = 'tasktrack:timezone-synced';

/** True for a real IANA zone like "Asia/Kolkata". Free text like "IST" is rejected. */
function isIanaZone(tz: string): boolean {
  if (!tz || !tz.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reminders ("due tomorrow") are scheduled in the student's own timezone. The stored
 * profile timezone was free text ("IST", "UTC +05:30") or the untouched "UTC" default,
 * so when it isn't a real zone this saves the browser's zone once per session. A
 * student who chose a real zone themselves is never overridden.
 */
export function TimezoneSync() {
  const { user, profile, refreshProfile } = useAuth();
  // refreshProfile is a new function each render; keep the latest in a ref so the
  // effect below only re-runs when the user or their stored timezone changes.
  const refreshRef = useRef(refreshProfile);
  refreshRef.current = refreshProfile;
  const userId = user?.id;
  const storedTz = profile ? profile.timezone || '' : null;

  useEffect(() => {
    if (!userId || storedTz === null) return;
    let browserTz = '';
    try {
      browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      return;
    }
    if (!isIanaZone(browserTz)) return;

    const stored = storedTz.trim();
    if (stored === browserTz || isIanaZone(stored)) return;

    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === userId) return;
      window.sessionStorage.setItem(SESSION_KEY, userId);
    } catch {
      // Storage blocked: the update below is idempotent, so it is safe to repeat.
    }

    supabase
      .from('profiles')
      .update({ timezone: browserTz })
      .eq('id', userId)
      .then(({ error }) => {
        if (!error) refreshRef.current();
      });
  }, [userId, storedTz]);

  return null;
}
