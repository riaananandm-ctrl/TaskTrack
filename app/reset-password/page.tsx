'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2, AlertCircle, CheckCircle2, Eye, EyeOff, Check, X as XIcon, MailCheck, RefreshCw,
} from 'lucide-react';
import {
  RESET_LINK_EXPIRED_MESSAGE, SIGNED_IN_NOT_RECOVERY_MESSAGE, MIN_PASSWORD_LENGTH,
  readRecoveryParams, passwordChecks, isPasswordStrong, safeResetMessage,
  hasFreshRecoveryHint, clearRecoveryHint,
} from '@/lib/password-recovery';
import { safeAuthMessage } from '@/lib/auth-email';
import { cn } from '@/lib/utils';

/**
 * The password reset screen.
 *
 * The form is never shown until a valid recovery session exists. Supabase hands the
 * recovery tokens to the browser when the client is created (detectSessionInUrl), which
 * fires a PASSWORD_RECOVERY event; we also poll the session briefly to cover the case
 * where that event fired before this component mounted. If neither happens, the link
 * was invalid, expired or already used, and we say so.
 *
 * No token is ever read, logged, stored in a table, or shown on screen — the Supabase
 * client holds the recovery session in memory/storage exactly as it does a normal one.
 */
export default function ResetPasswordPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [plainSession, setPlainSession] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const updateInFlight = useRef(false);
  const resendInFlight = useRef(false);

  const settled = useRef(false);
  const successRef = useRef(false);

  const accept = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    setHasRecovery(true);
    setChecking(false);
  }, []);

  const reject = useCallback((message: string, isPlainSession = false) => {
    if (settled.current) return;
    settled.current = true;
    setLinkError(message);
    setHasRecovery(false);
    setPlainSession(isPlainSession);
    setChecking(false);
  }, []);

  useEffect(() => {
    const declared = readRecoveryParams(window.location.href);

    // A link that says it is something else (for example a sign-up confirmation) should
    // not be treated as a reset attempt.
    if (declared.type !== null && declared.type !== 'recovery') {
      reject(RESET_LINK_EXPIRED_MESSAGE);
      return;
    }

    // Supabase reports an expired or already-used link in the URL itself.
    if (declared.hasError) {
      reject(RESET_LINK_EXPIRED_MESSAGE);
      return;
    }

    // The recovery session may already have been detected when the client was created,
    // which fires PASSWORD_RECOVERY. Listen for that as well as the session below.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        accept();
      } else if (event === 'SIGNED_OUT' && !successRef.current) {
        reject(RESET_LINK_EXPIRED_MESSAGE);
      }
    });

    // Poll for the session. The client parses the URL asynchronously, so the session
    // is often not readable on the very first tick. A session counts as recovery when
    // the link declared itself a recovery link, or when the auth provider has reported
    // a PASSWORD_RECOVERY event (the handoff hint — a UI hint, never proof; the
    // Supabase session itself is still required either way). The hint is re-checked on
    // every tick, so a provider event that lands after mount is still picked up. An
    // ordinary signed-in session with no such signal is never treated as recovery.
    const linkDeclaredRecovery = declared.isRecovery;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      const { data } = await supabase.auth.getSession();
      if (data.session && (linkDeclaredRecovery || hasFreshRecoveryHint())) {
        // The hint's purpose is served the moment the recovery framing is kept; clear
        // it so it cannot leak into a later visit. Clearing happens only on accept —
        // never before we know the outcome — so an effect rerun (for example under
        // React Strict Mode) still sees a valid recovery session and accepts again
        // instead of consuming the signal and then rejecting the same link.
        clearRecoveryHint();
        accept();
        clearInterval(interval);
        return;
      }
      if (attempts >= 25) {
        clearInterval(interval);
        if (data.session) {
          // A session exists but nothing ever signalled recovery. That is an ordinary
          // signed-in visit, not a failed exchange — the hint is deliberately left in
          // place only when a recovery exchange is genuinely still in flight; here
          // neither the URL nor the provider ever produced one, so nothing to clear.
          reject(SIGNED_IN_NOT_RECOVERY_MESSAGE, true);
        } else {
          // No session after the full window: the exchange failed or the link was
          // expired/used. Drop the hint so a failed establishment can never leave a
          // reusable signal behind.
          clearRecoveryHint();
          reject(RESET_LINK_EXPIRED_MESSAGE);
        }
      }
    }, 200);

    return () => {
      clearInterval(interval);
      subscription.unsubscribe();
    };
  }, [accept, reject]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // One in-flight request per form; "Password updated" only shows after the
    // update has actually succeeded.
    if (updateInFlight.current) return;
    setFormError(null);

    if (!isPasswordStrong(password)) {
      setFormError(`Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Those passwords do not match. Please re-enter them.');
      return;
    }

    updateInFlight.current = true;
    setSubmitting(true);
    try {
      // A Supabase session is always required before a password can be updated. The
      // form only renders after a recovery session was accepted, but re-verify here so
      // no state drift (or stale tab) can ever send an unauthenticated update.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setFormError(RESET_LINK_EXPIRED_MESSAGE);
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setFormError(safeResetMessage(error.message));
        return;
      }

      // The password is changed. End the recovery session so the student signs in fresh
      // with the new password, then send them to the login screen.
      successRef.current = true;
      clearRecoveryHint();
      try {
        await supabase.auth.signOut();
      } catch {
        // Signing out is a courtesy; the password change has already succeeded.
      }

      setSuccess(true);
      setTimeout(() => router.push('/login?message=password-updated'), 1600);
    } catch {
      setFormError(safeResetMessage('network'));
    } finally {
      setSubmitting(false);
      updateInFlight.current = false;
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resendInFlight.current) return;
    resendInFlight.current = true;
    setResendError(null);
    setResendNotice(null);
    setResending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resendEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        setResendError(safeAuthMessage(error.message));
        return;
      }
      setResendNotice('Check your email for a password reset link.');
    } catch {
      setResendError(safeAuthMessage('Network error. Please try again.'));
    } finally {
      setResending(false);
      resendInFlight.current = false;
    }
  };

  const checks = passwordChecks(password);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  // --- Success ---
  if (success) {
    return (
      <AuthLayout
        title="Password updated"
        subtitle="You can now sign in with your new password."
        footer={
          <Link href="/login" className="text-primary font-medium hover:underline">
            Go to login
          </Link>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              Your password has been updated. Taking you to the login screen&hellip;
            </p>
          </div>
          <Link href="/login" className="block">
            <Button className="w-full">Go to login</Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  // --- Checking for a recovery session ---
  if (checking) {
    return (
      <AuthLayout
        title="Reset your password"
        subtitle="Checking your reset link&hellip;"
      >
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">One moment&hellip;</p>
        </div>
      </AuthLayout>
    );
  }

  // --- Invalid or expired link ---
  if (!hasRecovery) {
    return (
      <AuthLayout
        title="Reset your password"
        subtitle="Request a new link to continue."
        footer={
          <Link href="/login" className="text-primary font-medium hover:underline">
            Back to login
          </Link>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{linkError ?? RESET_LINK_EXPIRED_MESSAGE}</p>
          </div>

          {plainSession && (
            <Link href="/app" className="block">
              <Button className="w-full">Continue to your dashboard</Button>
            </Link>
          )}

          {resendNotice && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-sm">
              <MailCheck className="w-4 h-4 flex-shrink-0" />
              {resendNotice}
            </div>
          )}
          {resendError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {resendError}
            </div>
          )}

          {!resendNotice && (
            <form onSubmit={handleResend} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="resend-email">Email</Label>
                <Input
                  id="resend-email"
                  type="email"
                  placeholder="alex@school.edu"
                  required
                  autoComplete="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={resending}>
                {resending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Request a new reset link
              </Button>
            </form>
          )}

          <Link href="/login" className="block">
            <Button variant="ghost" className="w-full">Back to login</Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  // --- Valid recovery session: the form ---
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Choose a new password for your TaskTrack account."
      footer={
        <>
          Remembered it?{' '}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Back to login
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {formError}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              placeholder="At least 6 characters"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-new-password">Confirm new password</Label>
          <div className="relative">
            <Input
              id="confirm-new-password"
              type={showConfirm ? 'text' : 'password'}
              placeholder="Re-enter your new password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {mismatch && (
            <p className="text-xs text-destructive">Those passwords do not match yet.</p>
          )}
        </div>

        {/* Password requirements */}
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Your password needs
          </p>
          <ul className="space-y-1.5">
            {checks.map((check) => (
              <li key={check.id} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
                    check.met ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {check.met ? <Check className="w-3 h-3" /> : <XIcon className="w-3 h-3" />}
                </span>
                <span className={check.met ? 'text-foreground' : 'text-muted-foreground'}>
                  {check.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Button type="submit" className="w-full" disabled={submitting || !isPasswordStrong(password) || password !== confirmPassword}>
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {submitting ? 'Updating\u2026' : 'Update password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
