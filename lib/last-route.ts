/**
 * Remembers the last in-app route so a closed-and-reopened tab (or an installed-PWA
 * launch) resumes where the student was instead of restarting at the landing page.
 *
 * Only the path string is stored, in sessionStorage (cleared when the tab closes for
 * good) — never tokens, user data, or form contents. Non-app routes (login, signup,
 * reset-password, the landing page) are never recorded, so a signed-out visitor is
 * never dropped back into the app frame by this mechanism; ProtectedRoute still gates
 * every render independently.
 */

const LAST_ROUTE_KEY = 'tasktrack.last-route';

/** In-app paths begin with /app; the guard also refuses anything that smells like an auth flow. */
function isRecordable(path: string): boolean {
  return (
    path.startsWith('/app') &&
    !path.startsWith('/app/login') &&
    !path.includes('reset') &&
    !path.includes('recovery')
  );
}

export function rememberLastRoute(path: string): void {
  if (!isRecordable(path)) return;
  try {
    sessionStorage.setItem(LAST_ROUTE_KEY, path);
  } catch {
    // Storage may be unavailable; resuming simply won't happen.
  }
}

/** The last recorded in-app route, or null. Consumes nothing — safe to call repeatedly. */
export function peekLastRoute(): string | null {
  try {
    const value = sessionStorage.getItem(LAST_ROUTE_KEY);
    return value && isRecordable(value) ? value : null;
  } catch {
    return null;
  }
}
