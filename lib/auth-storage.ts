/**
 * Auth session storage that honors the "Stay logged in for 30 days" choice.
 *
 * - Checked: the Supabase session (access + refresh tokens) lives in localStorage, so
 *   it survives closing the browser. A login timestamp caps the session at 30 days.
 * - Unchecked: the session lives in sessionStorage, which the browser clears when the
 *   tab closes — the intended short-lived behavior.
 *
 * The adapter picks the store on every call, because the checkbox is written just
 * before signInWithPassword runs, after the Supabase client (and this adapter) exist.
 * Tokens are only ever handled by the Supabase client; nothing here reads or logs
 * their values.
 */

import { REMEMBER_DEVICE_KEY } from './remember-device';

/** 30 days, in milliseconds. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Records the moment a persistent ("stay logged in") session began. */
const LOGIN_AT_KEY = 'tasktrack:login-at';

function persistentStoreSelected(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_DEVICE_KEY) !== '0';
  } catch {
    // Storage blocked: fall back to the safer, non-persistent store.
    return false;
  }
}

function pick(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return persistentStoreSelected() ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Storage adapter for the Supabase client. Satisfies the SupportedStorage shape. */
export const authStorage = {
  getItem(key: string): string | null {
    const store = pick();
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    const store = pick();
    if (!store) return;
    try {
      store.setItem(key, value);
    } catch {
      // Quota or blocked storage: the session simply won't persist.
    }
  },
  removeItem(key: string): void {
    const store = pick();
    if (!store) return;
    try {
      store.removeItem(key);
    } catch {
      // Nothing to do.
    }
  },
};

/** Record the start of a persistent session. Called on a "stay logged in" login. */
export function markPersistentLogin(): void {
  try {
    window.localStorage.setItem(LOGIN_AT_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the 30-day cap then cannot apply; the session still works.
  }
}

/** Remove the persistent-session start record (on logout or session end). */
export function clearPersistentLogin(): void {
  try {
    window.localStorage.removeItem(LOGIN_AT_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * True when a persistent session has aged past 30 days and must be ended. A missing
 * record (e.g. storage was blocked) never forces a logout.
 */
export function persistentLoginExpired(): boolean {
  try {
    const raw = window.localStorage.getItem(LOGIN_AT_KEY);
    if (!raw) return false;
    const startedAt = Number(raw);
    if (!Number.isFinite(startedAt)) return false;
    return Date.now() - startedAt > SESSION_TTL_MS;
  } catch {
    return false;
  }
}
