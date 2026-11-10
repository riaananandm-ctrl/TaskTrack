/**
 * "Remember this device" preference flag.
 *
 * Read by lib/auth-storage.ts at sign-in time: checked ("1" or absent) sends the
 * Supabase session to localStorage and starts a 30-day clock; unchecked ("0") sends
 * it to sessionStorage, which the browser clears when the tab closes.
 * forgetting the device (clearRememberDevice) also ends the stored session.
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
