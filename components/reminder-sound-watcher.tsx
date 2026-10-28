'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { dingDueReminders, markAudioUnlocked, pruneDinged } from '@/lib/reminder-sound';

/**
 * Watches for reminders that have just come due while TaskTrack is open and plays a
 * single in-app ding for each, but only when the student has turned on "Play reminder
 * sound". It stays completely silent otherwise.
 *
 * It never plays before the student has interacted with the page, never repeats a
 * reminder, and re-reads the preference so toggling the sound off stops it promptly.
 */

const CHECK_INTERVAL_MS = 30_000;
/** Only reminders that came due in the last few minutes are considered "just due". */
const FRESH_WINDOW_MS = 2 * 60 * 1000;

export function ReminderSoundWatcher() {
  const { user } = useAuth();
  const soundEnabled = useRef(false);

  // Unlock audio on the first real interaction, as browsers require.
  useEffect(() => {
    const unlock = () => markAudioUnlocked();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;

    const readPreference = async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('reminder_sound_enabled')
        .eq('user_id', user.id)
        .maybeSingle();
      if (active) soundEnabled.current = Boolean(data?.reminder_sound_enabled);
    };

    const check = async () => {
      if (!soundEnabled.current) return;
      const now = Date.now();
      const { data } = await supabase
        .from('reminders')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_enabled', true)
        .eq('is_read', false)
        .gte('scheduled_for', new Date(now - FRESH_WINDOW_MS).toISOString())
        .lte('scheduled_for', new Date(now).toISOString());
      if (!active) return;
      const ids = (data ?? []).map((r) => r.id as string);
      dingDueReminders(ids);
    };

    pruneDinged();
    readPreference().then(check);
    const preferenceTimer = setInterval(readPreference, CHECK_INTERVAL_MS * 2);
    const checkTimer = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(preferenceTimer);
      clearInterval(checkTimer);
    };
  }, [user]);

  return null;
}
