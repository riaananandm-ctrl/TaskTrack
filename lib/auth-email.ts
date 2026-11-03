/**
 * Plain-language messages for the account-confirmation flow. Supabase's own error
 * text is never shown to students — it is mapped to a safe, helpful sentence here.
 */

export const CONFIRM_REQUIRED_MESSAGE =
  'Please confirm your email address before signing in.';

export const CHECK_EMAIL_HEADLINE = 'Check your email to confirm your TaskTrack account.';

export const ACCOUNT_EXISTS_MESSAGE = 'This account already exists. Please log in.';

export const SIGNUP_GENERIC_NOTICE =
  'Check your inbox for any required confirmation. Already have an account? Log in or reset your password.';

/** Session-only key so signup can hand the typed email to the login screen. Never holds a password. */
export const SIGNIN_EMAIL_STORAGE_KEY = 'tasktrack:signin-email';

export type SignupErrorKind = 'duplicate-account' | 'other';

/**
 * Classify a signup error using Supabase's structured error code first, with a text
 * fallback only when no code is present. Returns 'duplicate-account' only when Supabase
 * itself explicitly reports an existing account — never inferred from a success shape,
 * timing, or anything else.
 */
export function classifySignupError(
  error: { code?: string | null; message?: string | null } | null | undefined
): SignupErrorKind {
  const code = (error?.code ?? '').toLowerCase();
  if (code === 'user_already_exists' || code === 'email_exists') {
    return 'duplicate-account';
  }
  // Only Supabase's own structured code may declare an existing account. Message-text
  // sniffing could state account existence on an error that carries no such guarantee.
  if (code === 'user_already_exists' || code === 'email_exists') {
    return 'duplicate-account';
  }
  return 'other';
}

/** Turn any Supabase auth error into a safe, understandable message. */
export function safeAuthMessage(message: string | undefined | null): string {
  const text = (message ?? '').toLowerCase();

  if (text.includes('email not confirmed')) {
    return CONFIRM_REQUIRED_MESSAGE;
  }
  if (text.includes('invalid login credentials')) {
    return 'That email or password doesn\u2019t look right. Please try again.';
  }
  if (text.includes('for security purposes') || text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts just now. Please wait a minute and try again.';
  }
  if (text.includes('invalid email') || text.includes('email address is invalid')) {
    return 'That email address doesn\u2019t look valid. Please check it and try again.';
  }
  if (text.includes('user already registered')) {
    return 'An account with this email already exists. Try logging in instead.';
  }
  if (text.includes('password') && text.includes('least')) {
    return 'Your password is too short. Please use at least 6 characters.';
  }
  if (text.includes('one-time token') || text.includes('otp_expired') || text.includes('token not found') || text.includes('already been')) {
    return 'This link has already been used or is no longer valid. Request a new email below.';
  }
  if (
    text.includes('unexpected_failure') ||
    text.includes('smtp') ||
    text.includes('535') ||
    text.includes('failed to send') ||
    text.includes('mail') && text.includes('error')
  ) {
    // The server explicitly failed to send the mail. Say so — never pretend it went out.
    return 'We couldn\u2019t send the email just now — the mail service is temporarily unavailable. Please try again in a few minutes.';
  }
  if (text.includes('unauthorized') || text.includes('not authorized')) {
    // Supabase's built-in email service refuses non-team addresses; this says nothing
    // about whether the account exists.
    return 'We couldn\u2019t send an email to this address right now. Please contact support if this keeps happening.';
  }
  if (text.includes('expired')) {
    return 'That link has expired. Request a new confirmation email below.';
  }
  if (text.includes('network') || text.includes('fetch')) {
    return 'We couldn\u2019t reach the server. Please check your connection and try again.';
  }
  return 'Something went wrong. Please try again in a moment.';
}
