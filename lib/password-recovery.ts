/**
 * Recovery-link helpers and safe copy for the password-reset flow.
 *
 * Supabase returns a recovery link in one of two shapes, depending on the project's
 * auth flow setting:
 *  - implicit flow: tokens arrive in the URL fragment (#access_token=...&type=recovery)
 *  - PKCE / token-hash flow: a ?code= or ?token_hash=...&type=recovery query arrives
 *
 * In every case the URL also carries `type=recovery`. That marker is what tells us a
 * link is a password-reset link, and it is the only thing we look at — no token is ever
 * read, stored, logged or displayed here.
 */

export const RESET_LINK_EXPIRED_MESSAGE =
  'This password reset link is invalid or has expired. Request a new link.';

/** Shown when the visitor is signed in but arrived without a recovery link. */
export const SIGNED_IN_NOT_RECOVERY_MESSAGE =
  'You are already signed in. If you want to change your password, use the reset link from your email, or continue to the app below.';

export const CHECK_EMAIL_FOR_RESET_MESSAGE =
  'Check your email for a password reset link.';

/** Password rules, matching the sign-up screen (Supabase requires 6 or more). */
export const MIN_PASSWORD_LENGTH = 6;

export interface PasswordCheck {
  id: string;
  label: string;
  met: boolean;
}

/** The requirement checklist shown live under the new-password field. */
export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: password.length >= MIN_PASSWORD_LENGTH },
    { id: 'letter', label: 'A letter', met: /[a-zA-Z]/.test(password) },
    { id: 'number', label: 'A number', met: /[0-9]/.test(password) },
  ];
}

/** Whether a password satisfies every rule. */
export function isPasswordStrong(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * A short-lived, non-secret UI hint that a PASSWORD_RECOVERY event was just received,
 * used only so the reset screen keeps its recovery framing across a navigation that
 * outlives the auth event. It is never proof of anything: the Supabase session is
 * always verified independently, and only a timestamp is stored — never a URL or token.
 */
const RECOVERY_HINT_KEY = 'tasktrack_recovery_hint';
const RECOVERY_HINT_TTL_MS = 5 * 60 * 1000;

export function markRecoveryHandoff(): void {
  try {
    sessionStorage.setItem(RECOVERY_HINT_KEY, String(Date.now()));
  } catch {
    // Storage may be unavailable; the direct-arrival flow still works without the hint.
  }
}

export function hasFreshRecoveryHint(): boolean {
  try {
    const raw = sessionStorage.getItem(RECOVERY_HINT_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) <= RECOVERY_HINT_TTL_MS;
  } catch {
    return false;
  }
}

export function clearRecoveryHint(): void {
  try {
    sessionStorage.removeItem(RECOVERY_HINT_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

/**
 * Deterministic single-owner claim for the redirect to /reset-password. Both the auth
 * provider (on the PASSWORD_RECOVERY event) and RecoveryLinkGuard (on seeing a recovery
 * link) may want to navigate; exactly one of them wins the claim, whoever runs first,
 * and the other does nothing. Module-scoped and in-memory: it coordinates one document,
 * and after any navigation the claim starts fresh on the new page.
 */
let recoveryRedirectClaimed = false;

export function claimRecoveryRedirect(): boolean {
  if (recoveryRedirectClaimed) return false;
  recoveryRedirectClaimed = true;
  return true;
}

/** Read the recovery markers from the current URL without touching any token value. */
export function readRecoveryParams(url: string): {
  /** The link's declared purpose, e.g. 'recovery' for a password reset. */
  type: string | null;
  isRecovery: boolean;
  hasError: boolean;
  errorDescription: string | null;
  hasToken: boolean;
} {
  let hash = new URLSearchParams();
  let query = new URLSearchParams();
  try {
    const parsed = new URL(url);
    hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    query = parsed.searchParams;
  } catch {
    return { type: null, isRecovery: false, hasError: false, errorDescription: null, hasToken: false };
  }

  const get = (key: string) => query.get(key) ?? hash.get(key);

  const type = get('type');
  const hasToken =
    Boolean(get('access_token')) ||
    Boolean(get('token_hash')) ||
    Boolean(get('code'));

  // A recovery link declares itself. Tokens with no declared type are also treated as a
  // recovery attempt, which covers the PKCE shape (?code=...) that omits the marker.
  const isRecovery = type === 'recovery' || (hasToken && type === null);

  return {
    type,
    isRecovery,
    hasError: Boolean(get('error') || get('error_description') || get('error_code')),
    errorDescription: get('error_description') ?? get('error'),
    hasToken,
  };
}

/**
 * Turn any Supabase recovery error into a safe, plain sentence. The raw provider text
 * is never shown, because it can name internal endpoints.
 */
export function safeResetMessage(message: string | undefined | null): string {
  const text = (message ?? '').toLowerCase();

  if (text.includes('expired') || text.includes('invalid') || text.includes('token')) {
    return RESET_LINK_EXPIRED_MESSAGE;
  }
  if (text.includes('rate limit') || text.includes('too many') || text.includes('for security purposes')) {
    return 'Too many attempts just now. Please wait a minute and try again.';
  }
  if (text.includes('weak_password') || text.includes('pwned') || text.includes('known to be weak')) {
    return 'That password is too easy to guess. Please choose a stronger one.';
  }
  if (text.includes('password') && (text.includes('least') || text.includes('weak'))) {
    return `Your password is too short. Please use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (text.includes('network') || text.includes('fetch')) {
    return 'We couldn\u2019t reach the server. Please check your connection and try again.';
  }
  return 'Something went wrong. Please try again in a moment.';
}
