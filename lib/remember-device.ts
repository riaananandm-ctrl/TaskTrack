/**
 * "Remember this device" preference flag.
 *
 * This is a UI preference only. Supabase session persistence is always enabled
 * via localStorage, so the user stays signed in regardless of this flag.
 * The flag is kept for the settings page UI and future use.
 */
export const REMEMBER_DEVICE_KEY = 'tasktrack:remember-device';

/** Plain-language note shown next to the option. */
export const REMEMBER_DEVICE_NOTICE =
  'Your device stays signed in. You can sign out anytime from Settings.';

export function setRememberDevice(remember: boolean): void {
  try {
    window.localStorage.setItem(REMEMBER_DEVICE_KEY, remember ? '1' : '0');
  } catch {
    // A blocked storage API must never break signing in.
  }
}

export function isRememberDevice(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_DEVICE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function clearRememberDevice(): void {
  try {
    window.localStorage.removeItem(REMEMBER_DEVICE_KEY);
  } catch {
    // Ignore — nothing to clear.
  }
}
