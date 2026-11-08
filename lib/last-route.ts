/**
 * Remembers the last in-app route so a closed-and-reopened tab (or an installed-PWA
 * launch) resumes where the student was instead of restarting at the landing page.
 *
 * Only the path string is stored, in sessionStorage (cleared when the tab closes for
 * good) — never tokens, user data, form contents, or filters. The stored value is
 * treated as untrusted input: every read and write passes `validateInternalAppRoute`,
 * so a tampered or malformed value can never become a navigation target. Non-app
 * routes are never recorded, and ProtectedRoute still gates every render
 * independently, so this mechanism can never drop a signed-out visitor into the app.
 *
 * Same-user safety: the store is session-scoped to a single browser tab. Routes
 * contain no user identifiers, so a value can only ever be restored in the same
 * tab — and thus the same authenticated session — that wrote it.
 */

const LAST_ROUTE_KEY = 'tasktrack.last-route';

/**
 * Accepts only a safe internal app path, e.g. "/app/tasks" or "/app/calendar?view=week".
 *
 * Rejects: anything not starting with exactly "/app/", protocol-relative URLs
 * ("//evil.example"), absolute URLs ("https://evil.example", "http://…"),
 * encoded externals ("%2f%2fevil.example", "%2F%2F…"), backslash tricks
 * ("/app\\..//evil.example"), any value containing "://" or a userinfo/authority
 * "@" segment, control characters, and absurd lengths.
 */
export function validateInternalAppRoute(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const route = value;

  if (route.length === 0 || route.length > 2048) return null;
  if (!route.startsWith('/app/')) return null;
  if (route.startsWith('/app//')) return null; // empty first segment trick
  if (route.includes('//')) return null; // protocol-relative or empty segment tricks
  if (route.includes('\\')) return null; // backslash path confusion
  if (route.includes('://')) return null; // any explicit protocol
  if (route.includes('@')) return null; // userinfo/authority tricks
  if (/[<>"'`]/.test(route)) return null; // HTML/attribute injection payloads
  if (/[\u0000-\u001f\u007f]/.test(route)) return null; // control characters

  // Encoded externals: decode once and re-run the structural checks on the decoded
  // form, so "%2f%2fevil.example" or "%2F%2F…" cannot smuggle "//" past the checks.
  try {
    const decoded = decodeURIComponent(route);
    if (decoded !== route) {
      if (decoded.includes('//') || decoded.includes('\\') || decoded.includes('://') || decoded.includes('@')) {
        return null;
      }
      if (!decoded.startsWith('/app/') || decoded.startsWith('/app//')) return null;
      // Path traversal in decoded form: reject any "." or ".." segment.
      if (decoded.split('/').some((seg) => seg === '.' || seg === '..')) return null;
    }
  } catch {
    // Malformed percent-encoding: reject rather than guess intent.
    return null;
  }

  // Path traversal in plain form as well.
  if (route.split('/').some((seg) => seg === '.' || seg === '..')) return null;

  return route;
}

function isRecordable(path: string): boolean {
  return validateInternalAppRoute(path) !== null;
}

/** Records a validated in-app route. Untrusted or non-app values are ignored. */
export function rememberLastRoute(path: string): void {
  if (!isRecordable(path)) return;
  try {
    sessionStorage.setItem(LAST_ROUTE_KEY, path);
  } catch {
    // Storage may be unavailable; resuming simply won't happen.
  }
}

/**
 * Returns the last recorded in-app route after re-validation, or null. The stored
 * value is never trusted: a tampered entry (e.g. "//evil.example" or
 * "https://evil.example") fails validation and callers fall back to "/app".
 */
export function peekLastRoute(): string | null {
  try {
    const value = sessionStorage.getItem(LAST_ROUTE_KEY);
    return value ? validateInternalAppRoute(value) : null;
  } catch {
    return null;
  }
}

/**
 * Pure decision for the tab-resume redirect. Returns the internal path to navigate
 * to, or null to stay put.
 *
 * - Auth must be resolved (loading is false) before any decision.
 * - Only a signed-in, confirmed user on the landing page "/" (a reopened or
 *   discarded tab) is redirected.
 * - Anyone already on a valid /app route is never redirected (loop guard).
 * - Auth and recovery pages, and any active recovery flow, are never hijacked.
 * - No stored route, or a stored route failing validation, falls back to /app.
 */
export function resolveResumeRoute(options: {
  pathname: string;
  authenticated: boolean;
  emailConfirmed: boolean;
  loading: boolean;
  recoveryActive: boolean;
  stored: string | null;
}): string | null {
  const { pathname, authenticated, emailConfirmed, loading, recoveryActive, stored } = options;

  if (loading) return null;
  if (!authenticated || !emailConfirmed) return null;
  if (recoveryActive) return null;
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth/')
  ) {
    return null;
  }
  if (pathname.startsWith('/app/')) return null;
  if (pathname !== '/') return null;

  const target = validateInternalAppRoute(stored);
  if (!target) return '/app';
  if (target === pathname) return null;
  return target;
}
