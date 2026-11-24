import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Marketing attribution: which link a new student signed up from.
 *
 * Links in ads and posters carry ?ref=<tag> (tasktrackbm.vercel.app/?ref=meta).
 * The tag is kept in localStorage for 7 days, since people often land, leave and
 * sign up later. The newest tag wins. Once the student is signed in, the tag is
 * sent once to record_signup_ref, which only saves it for an account made in the
 * last hour, so existing users who click an ad are never counted as sign-ups.
 */
const KEY = 'tasktrack.signup_ref';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A short lowercase tag, or null. Matches the check in record_signup_ref. */
export function cleanRef(raw: string | null | undefined): string | null {
  const ref = (raw ?? '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(ref) ? ref : null;
}

/** Saves ?ref from the current URL, if there is a valid one. */
export function captureSignupRef(search: string, now = Date.now()): void {
  try {
    const ref = cleanRef(new URLSearchParams(search).get('ref'));
    if (ref) localStorage.setItem(KEY, JSON.stringify({ ref, at: now }));
  } catch {
    // Private mode or storage full: attribution is optional.
  }
}

/** The saved tag if it is under 7 days old. */
export function storedSignupRef(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { ref, at } = JSON.parse(raw) as { ref?: string; at?: number };
    if (typeof at !== 'number' || now - at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return cleanRef(ref);
  } catch {
    return null;
  }
}

/** Sends the saved tag for the signed-in student, once. */
export async function reportSignupRef(client: SupabaseClient): Promise<void> {
  const ref = storedSignupRef();
  if (!ref) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  await client.rpc('record_signup_ref', { p_ref: ref });
}
