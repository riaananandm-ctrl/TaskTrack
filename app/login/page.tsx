'use client';

import { useRef, useState, useEffect, Suspense } from 'react';
import { BrandLoading } from '@/components/brand-loading';
import { AuthLayout } from '@/components/auth-layout';
import { GoogleSignInButton, AuthDivider } from '@/components/google-sign-in-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase/client';
import { setRememberDevice, REMEMBER_DEVICE_NOTICE } from '@/lib/remember-device';
import { markPersistentLogin, clearPersistentLogin, persistentLoginExpired } from '@/lib/auth-storage';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { peekLastRoute } from '@/lib/last-route';
import { Loader2, AlertCircle, MailCheck, Eye, EyeOff } from 'lucide-react';
import { safeAuthMessage, CONFIRM_REQUIRED_MESSAGE, SIGNIN_EMAIL_STORAGE_KEY } from '@/lib/auth-email';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    try {
      const handedOff = sessionStorage.getItem(SIGNIN_EMAIL_STORAGE_KEY);
      if (handedOff) {
        setEmail(handedOff);
        sessionStorage.removeItem(SIGNIN_EMAIL_STORAGE_KEY);
      }
    } catch {
      // Storage may be blocked; the email field simply stays empty.
    }
  }, []);

  useEffect(() => {
    if (searchParams.get('message') === 'confirm') {
      setInfo('Please confirm your email address before signing in.');
    } else if (searchParams.get('message') === 'session-ended') {
      setInfo('You\u2019ve been signed out. Please log in again.');
    } else if (searchParams.get('message') === 'password-updated') {
      setInfo('Your password has been updated. Log in with your new password.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // One in-flight request per form: double clicks and re-submits are ignored.
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setInfo(null);
    setLoading(true);

    // Choose Supabase's session storage location before authenticating, so the
    // session is written to the right place from the very first token.
    setRememberDevice(remember);

    // Every path — bad password, unconfirmed email, network failure, thrown error —
    // must end the spinner and show something, or the button appears to hang forever.
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        const msg = safeAuthMessage(error.message);
        setError(msg);
        // When the server says the email isn't confirmed, offer a resend link.
        if (error.message.toLowerCase().includes('email not confirmed')) {
          setNeedsConfirm(true);
        }
        return;
      }

      // If the server has confirmation off, the login may have succeeded for an
      // unconfirmed user. Check the confirmation status before proceeding.
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const confirmed = !!currentUser?.email_confirmed_at || !!currentUser?.confirmed_at;
      if (!confirmed) {
        await supabase.auth.signOut();
        setError(CONFIRM_REQUIRED_MESSAGE);
        setNeedsConfirm(true);
        return;
      }

      const next = searchParams.get('next');
      // An explicit ?next= wins. Otherwise resume the last in-app route this tab was
      // on (session-scoped), so a closed-and-reopened tab picks up where it left off
      // instead of always landing on the dashboard.
      if (remember) markPersistentLogin();
      const resumeRoute = peekLastRoute();
      router.push(next && next.startsWith('/') ? next : resumeRoute || '/app');
    } catch {
      setError('We couldn\u2019t reach the server. Please check your connection and try again.');
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your TaskTrack account."
      footer={
        <>
          Don&rsquo;t have an account?{' '}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <GoogleSignInButton label="Continue with Google" next={searchParams.get('next')} onError={setError} />
        <AuthDivider />
        {info && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 text-foreground text-sm border border-primary/15">
            <MailCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary" />
            {info}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="alex@school.edu"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <div className="relative">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Your password"
            required
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

        <div className="rounded-lg border border-border p-3">
          <label htmlFor="remember-device" className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              id="remember-device"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Remember this device for 30 days</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Optional. {REMEMBER_DEVICE_NOTICE}
              </span>
            </span>
          </label>
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Log in
        </Button>

        {needsConfirm && (
          <div className="space-y-2">
            {resendNotice && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-sm">
                <MailCheck className="w-4 h-4 flex-shrink-0" />
                {resendNotice}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={resending || !email}
              onClick={async () => {
                setResending(true);
                setResendNotice(null);
                const { error: resendError } = await supabase.auth.resend({
                  type: 'signup',
                  email,
                  options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
                });
                setResending(false);
                if (resendError) {
                  setError(safeAuthMessage(resendError.message));
                } else {
                  setResendNotice(`A new confirmation email is on its way to ${email}.`);
                }
              }}
            >
              {resending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Resend confirmation email
            </Button>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<BrandLoading />}>
      <LoginForm />
    </Suspense>
  );
}
