'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { BrandLoading } from '@/components/brand-loading';
import { peekLastRoute } from '@/lib/last-route';
import { GoogleSignInButton, AuthDivider } from '@/components/google-sign-in-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { YEAR_GROUPS } from '@/lib/types';
import { cleanName, MAX_NAME_LENGTH, MAX_SCHOOL_LENGTH } from '@/lib/initials';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, MailCheck, Check, Info } from 'lucide-react';
import {
  safeAuthMessage, CHECK_EMAIL_HEADLINE, ACCOUNT_EXISTS_MESSAGE, SIGNUP_GENERIC_NOTICE,
  classifySignupError, SIGNIN_EMAIL_STORAGE_KEY, PENDING_CONFIRM_EMAIL_KEY,
} from '@/lib/auth-email';

/** Removes any address left by a previous signup so a new action is never resent to it. */
const clearPendingConfirmEmail = () => {
  try {
    window.localStorage.removeItem(PENDING_CONFIRM_EMAIL_KEY);
  } catch {
    // Storage may be blocked; there is simply nothing to clear.
  }
};

export default function SignupPage() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<{ email?: string | null } | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [genericSignup, setGenericSignup] = useState(false);
  const [duplicateAccount, setDuplicateAccount] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    yearGroup: '',
    schoolName: '',
  });
  const inFlight = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      const confirmed = !!user?.email_confirmed_at || !!user?.confirmed_at;
      if (user && confirmed) {
        // A signed-in student has nothing to do here: take them straight in.
        setSessionUser(user);
        router.replace(peekLastRoute() || '/app');
      } else {
        setSessionUser(null);
      }
    });
  }, [router]);

  const goToLogin = () => {
    try {
      sessionStorage.setItem(SIGNIN_EMAIL_STORAGE_KEY, formData.email);
    } catch {
      // Storage may be blocked; the login screen will simply not prefill.
    }
    router.push('/login');
  };

  const goToForgotPassword = () => {
    try {
      sessionStorage.setItem(SIGNIN_EMAIL_STORAGE_KEY, formData.email);
    } catch {
      // Storage may be blocked; the recovery screen will simply not prefill.
    }
    router.push('/forgot-password');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // One in-flight request per form: double clicks and re-submits are ignored.
    if (inFlight.current) return;
    setError(null);
    setNotice(null);
    setDuplicateAccount(false);
    setGenericSignup(false);

    const fullName = cleanName(formData.fullName);
    const email = formData.email.trim();
    if (!fullName) {
      setError('Please enter your name.');
      return;
    }
    if (!email) {
      setError('Please enter your email.');
      return;
    }
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!formData.password.trim() || new Set(formData.password).size < 3) {
      setError('That password is too easy to guess. Use a mix of letters, numbers or symbols.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('This password doesn\u2019t match. Please re-enter both passwords.');
      return;
    }

    inFlight.current = true;
    setLoading(true);

    let result;
    try {
      result = await supabase.auth.signUp({
        email,
        password: formData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: fullName,
            year_group: formData.yearGroup,
            school_name: cleanName(formData.schoolName, MAX_SCHOOL_LENGTH),
          },
        },
      });
    } catch {
      clearPendingConfirmEmail();
      setError(safeAuthMessage('network'));
      setLoading(false);
      inFlight.current = false;
      return;
    }
    const { data, error } = result;

    if (error) {
      const isDuplicate = classifySignupError(error) === 'duplicate-account';
      setError(
        isDuplicate
          ? ACCOUNT_EXISTS_MESSAGE
          : safeAuthMessage(error.message)
      );
      setDuplicateAccount(isDuplicate);
      // A failed signup must not leave a previous address saved, or the
      // confirmation screen could offer a resend to the wrong account.
      clearPendingConfirmEmail();
      setLoading(false);
      inFlight.current = false;
      return;
    }

    if (!data.user) {
      clearPendingConfirmEmail();
      setError('We couldn\u2019t create your account just now. Please try again.');
      setLoading(false);
      inFlight.current = false;
      return;
    }

    // Supabase returns an empty identities list for an address that is already registered.
    if (data.user.identities?.length === 0) {
      clearPendingConfirmEmail();
      setError(ACCOUNT_EXISTS_MESSAGE);
      setDuplicateAccount(true);
      setLoading(false);
      inFlight.current = false;
      return;
    }

    // A real session for this address means the account is confirmed and signed in;
    // no confirmation email is pending for it anymore.
    if (data.session && data.user?.email?.toLowerCase() === formData.email.trim().toLowerCase()) {
      clearPendingConfirmEmail();
      router.push('/starter');
      return;
    }

    // A no-session response covers both a brand-new account and an existing unconfirmed
    // one — the screen below uses wording that is accurate for either, without revealing
    // which (account-enumeration safety).
    setSentTo(formData.email);
    setGenericSignup(true);
    try {
      // Remember the address locally so the confirmation screen can offer a resend.
      window.localStorage.setItem(PENDING_CONFIRM_EMAIL_KEY, formData.email);
    } catch {
      // Storage may be blocked; the resend button simply won't be offered.
    }
    setNotice(SIGNUP_GENERIC_NOTICE);
    setLoading(false);
    inFlight.current = false;
  };

  const handleResend = async () => {
    if (!sentTo) return;
    setResending(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: sentTo,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    if (error) {
      setError(safeAuthMessage(error.message));
      return;
    }
    setNotice(`A new confirmation email is on its way to ${sentTo}.`);
  };

  const resetToForm = () => {
    // The student is changing the address, so the saved one must not be offered
    // for a resend of a signup they have abandoned.
    clearPendingConfirmEmail();
    setSentTo(null);
    setGenericSignup(false);
    setError(null);
    setNotice(null);
  };

  // Already signed in (or still checking): never show the form or an
  // "already signed in" screen. The effect above sends them into the app.
  if (sessionUser === undefined || sessionUser !== null) {
    return <BrandLoading />;
  }

  // Confirmation screen shown after the account is created.
  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="One quick step to finish setting up your account."
        footer={
          <>
            Already confirmed?{' '}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Back to login
            </Link>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/15">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <MailCheck className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{CHECK_EMAIL_HEADLINE}</p>
              <p className="text-sm text-muted-foreground mt-1 break-words">
                If <span className="font-medium text-foreground">{sentTo}</span> still needs confirming, a confirmation
                link is on its way to that inbox. Open it to finish setting up your account.
              </p>
            </div>
          </div>

          {notice && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-sm">
              <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {notice}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Button onClick={handleResend} disabled={resending} className="w-full" variant="outline">
              {resending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Resend confirmation email
            </Button>
            <Button onClick={goToLogin} className="w-full" variant="ghost">Go to login</Button>
            <Button onClick={goToForgotPassword} className="w-full" variant="ghost">Forgot password?</Button>
            <Button onClick={resetToForm} className="w-full" variant="ghost">
              Change email address
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start organising your schoolwork today."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <GoogleSignInButton label="Sign up with Google" next={null} onError={setError} />
        <AuthDivider />
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
            {duplicateAccount && (
              <div className="flex flex-wrap gap-2 w-full mt-2">
                <Button type="button" size="sm" className="flex-1" onClick={goToLogin}>
                  Log in
                </Button>
                <Button type="button" size="sm" variant="outline" className="flex-1" onClick={goToForgotPassword}>
                  Forgot password?
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            type="text"
            placeholder="Alex Chen"
            required
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
            value={formData.fullName}
            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="alex@school.edu"
            required
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="At least 8 characters"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Re-enter your password"
            required
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
          />
          {formData.confirmPassword.length > 0 && formData.confirmPassword !== formData.password && (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="yearGroup">Year group</Label>
          <Select
            value={formData.yearGroup}
            onValueChange={(v) => setFormData({ ...formData, yearGroup: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select your year group" />
            </SelectTrigger>
            <SelectContent>
              {YEAR_GROUPS.map((yg) => (
                <SelectItem key={yg} value={yg}>
                  {yg}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="schoolName">School name (optional)</Label>
          <Input
            id="schoolName"
            type="text"
            placeholder="Your school"
            maxLength={MAX_SCHOOL_LENGTH}
            value={formData.schoolName}
            onChange={(e) => setFormData({ ...formData, schoolName: e.target.value })}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Create account
        </Button>
        <p className="text-center text-xs leading-5 text-muted-foreground">
          By creating an account you agree to our{' '}
          <Link href="/terms" className="underline">Terms of Service</Link> and{' '}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 text-sm">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
          <p className="min-w-0 break-words text-muted-foreground">{SIGNUP_GENERIC_NOTICE}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" className="flex-1 whitespace-normal" onClick={goToLogin}>
            Log in
          </Button>
          <Button type="button" variant="ghost" className="flex-1 whitespace-normal" onClick={goToForgotPassword}>
            Forgot password?
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
