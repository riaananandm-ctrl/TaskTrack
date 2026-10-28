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
