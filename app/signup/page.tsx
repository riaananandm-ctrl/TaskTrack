'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { YEAR_GROUPS } from '@/lib/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, MailCheck, Check, Info, ArrowRight } from 'lucide-react';
import {
  safeAuthMessage, CHECK_EMAIL_HEADLINE, ACCOUNT_EXISTS_MESSAGE, SIGNUP_GENERIC_NOTICE,
  classifySignupError, SIGNIN_EMAIL_STORAGE_KEY, PENDING_CONFIRM_EMAIL_KEY,
} from '@/lib/auth-email';

export default function SignupPage() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<{ email?: string | null } | null | undefined>(undefined);
  const [signingOut, setSigningOut] = useState(false);
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
    supabase.auth.getUser().then(({ data }) => {
      setSessionUser(data.user ?? null);
    });
  }, []);

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

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    setSessionUser(null);
    setSigningOut(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // One in-flight request per form: double clicks and re-submits are ignored.
    if (inFlight.current) return;
    setError(null);
    setNotice(null);
    setDuplicateAccount(false);
    setGenericSignup(false);

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('This password doesn\u2019t match. Please re-enter both passwords.');
      return;
    }

    inFlight.current = true;
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: formData.fullName,
          year_group: formData.yearGroup,
          school_name: formData.schoolName,
        },
      },
    });

    if (error) {
      const isDuplicate = classifySignupError(error) === 'duplicate-account';
      setError(
        isDuplicate
          ? ACCOUNT_EXISTS_MESSAGE
          : safeAuthMessage(error.message)
      );
      setDuplicateAccount(isDuplicate);
      setLoading(false);
      inFlight.current = false;
      return;
    }

    // Supabase deliberately returns a session for an existing, confirmed account when
    // anti-enumeration is on. Signing in an unknown person that way would bypass the
    // confirmation gate the login screen enforces, so confirm the session actually
    // belongs to the address typed here.
    if (data.session && data.user?.email?.toLowerCase() === formData.email.trim().toLowerCase()) {
      router.push('/starter');
      return;
    }

    // An explicitly confirmed-existing response, or a generic success that may cover an
    // existing account, both land here.
    const explicitlyConfirmedExisting = !data.session && !!data.user;
    setSentTo(formData.email);
    setGenericSignup(true);
    try {
      // Remember the address locally so the confirmation screen can offer a resend.
      window.localStorage.setItem(PENDING_CONFIRM_EMAIL_KEY, formData.email);
    } catch {
      // Storage may be blocked; the resend button simply won't be offered.
    }
    setNotice(
      explicitlyConfirmedExisting
        ? ACCOUNT_EXISTS_MESSAGE
        : SIGNUP_GENERIC_NOTICE
    );
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
    setSentTo(null);
    setGenericSignup(false);
    setError(null);
    setNotice(null);
  };

  if (sessionUser !== null && sessionUser !== undefined) {
    return (
      <AuthLayout
        title="You're already signed in"
        subtitle={sessionUser.email ?? 'You already have an active session.'}
        footer={
          <>
            Not you?{' '}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="text-primary font-medium hover:underline disabled:opacity-60"
            >
              {signingOut ? 'Signing out\u2026' : 'Sign out first'}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/15">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <ArrowRight className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Continue to TaskTrack</p>
              <p className="text-sm text-muted-foreground mt-1">
                You already have an active session on this device.
              </p>
            </div>
          </div>

          <Button className="w-full" onClick={() => router.push('/app')} disabled={signingOut}>
            Continue to TaskTrack
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Want to use a different account? Sign out first, then come back to sign up or log in.
          </p>
        </div>
      </AuthLayout>
    );
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
                We sent a confirmation link to <span className="font-medium text-foreground">{sentTo}</span>.
                Open it to finish creating your account.
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
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
            {duplicateAccount && (
              <div className="flex gap-2 w-full mt-2">
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
            placeholder="At least 6 characters"
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
            value={formData.schoolName}
            onChange={(e) => setFormData({ ...formData, schoolName: e.target.value })}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Create account
        </Button>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 text-sm">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
          <p className="text-muted-foreground">{SIGNUP_GENERIC_NOTICE}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={goToLogin}>
            Log in
          </Button>
          <Button type="button" variant="ghost" className="flex-1" onClick={goToForgotPassword}>
            Forgot password?
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
