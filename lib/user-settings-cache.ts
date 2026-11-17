'use client';

import { supabase } from '@/lib/supabase/client';

/**
 * One shared read of the student's `user_settings` row. Theme, font, reminder sound
 * and push settings all need it on start-up; without this each made its own request.
 * The result is kept for 60 seconds, and writes made through `patchUserSettingsCache`
 * update it so readers never see a value older than the student's last change.
 */
type Row = Record<string, unknown> | null;

const TTL_MS = 60_000;
let cached: { userId: string; at: number; promise: Promise<Row> } | null = null;

export function getUserSettings(userId: string): Promise<Row> {
  if (cached && cached.userId === userId && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise: Promise<Row> = (async () => {
    const { data } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
    return (data as Row) ?? null;
  })();
  cached = { userId, at: Date.now(), promise };
  // A failed read must not be cached.
  promise.catch(() => { if (cached?.promise === promise) cached = null; });
  return promise;
}

/** Keep the shared copy in step with a write the student just made. */
export function patchUserSettingsCache(userId: string, patch: Record<string, unknown>) {
  if (!cached || cached.userId !== userId) return;
  const prev = cached.promise;
  cached = { ...cached, promise: prev.then((row) => ({ ...(row ?? {}), ...patch })) };
}

export function clearUserSettingsCache() {
  cached = null;
}
