'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, CheckCircle2, MailCheck } from 'lucide-react';
import { safeAuthMessage, PENDING_CONFIRM_EMAIL_KEY } from '@/lib/auth-email';
import { markPersistentLogin } from '@/lib/auth-storage';
import { isRememberDevice } from '@/lib/remember-device';

const PENDING_EMAIL_KEY = PENDING_CONFIRM_EMAIL_KEY;


type State =
  | { kind: 'working' }
  | { kind: 'success' }
  | { kind: 'error'; message: string; canResend: boolean };

export default function ConfirmPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'working' });
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pendingEmail = () => {
    try {
      return window.localStorage.getItem(PENDING_EMAIL_KEY);
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let done = false;
    const finish = (next: State) => {
      if (!done) {
        done = true;
        // Confirming signs the student in; on a remembered device, start the 30-day clock.
        if (next.kind === 'success' && isRememberDevice()) markPersistentLogin();
        setState(next);
      }
    };

    (async () => {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      const query = url.searchParams;

      // Supabase reports a problem (expired or already-used link, etc.) in the URL.
      const describedError =
        hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error');
      if (describedError) {
        const expired = describedError.toLowerCase().includes('expired');
        finish({
          kind: 'error',
          message: expired
            ? 'That confirmation link has expired. Request a new one below.'
            : 'We couldn\u2019t confirm this link. It may already have been used, or the address may be wrong.',
          canResend: !!pendingEmail(),
        });
        return;
      }

      // Implicit flow: tokens are returned in the URL fragment. A recovery link that
      // landed here is forwarded to the reset screen, fragment and all.
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      if (accessToken && refreshToken && hash.get('type') === 'recovery') {
        window.location.replace(`/reset-password${window.location.search}${window.location.hash}`);
        return;
      }
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          finish({ kind: 'error', message: safeAuthMessage(error.message), canResend: !!pendingEmail() });
          return;
        }
        finish({ kind: 'success' });
        return;
      }

      // Token-hash flow: verify the one-time token.
      const tokenHash = query.get('token_hash') || hash.get('token_hash');
      const type = query.get('type') || hash.get('type') || 'signup';

      // A recovery token has arrived on the confirmation route (for example because the
      // email template was left pointing here). Hand it to the reset screen so the
      // student sets a new password instead of being confirmed and dropped in the app.
      if (tokenHash && type === 'recovery') {
        window.location.replace(`/reset-password${window.location.search}${window.location.hash}`);
        return;
      }

      if (tokenHash) {
        // detectSessionInUrl (in the client) may already have consumed this one-time
        // token while the page loaded. Verifying the same token again always fails
        // with "One-time token not found" — an existing valid session means the
        // exchange already happened, so treat it as success instead of re-verifying.
        const { data: existing } = await supabase.auth.getSession();
        if (existing.session) {
          finish({ kind: 'success' });
          return;
        }
        const { error } = await supabase.auth.verifyOtp({
          type: (type as 'signup' | 'email' | 'recovery' | 'email_change' | 'invite') || 'signup',
          token_hash: tokenHash,
        });
        if (error) {
          finish({ kind: 'error', message: safeAuthMessage(error.message), canResend: !!pendingEmail() });
          return;
        }
        finish({ kind: 'success' });
        return;
      }

      // No parameters: the client may already have detected the session.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        finish({ kind: 'success' });
        return;
      }
      finish({
        kind: 'error',
        message: 'This confirmation link is incomplete or invalid. Try signing in, or request a new email.',
        canResend: !!pendingEmail(),
      });
    })();

    return () => {
      done = true;
    };
  }, []);

  const handleResend = async () => {
    const email = pendingEmail();
    if (!email) return;
    setResending(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setState({ kind: 'error', message: safeAuthMessage(error.message), canResend: true });
      } else {
        setNotice(`A new confirmation email is on its way to ${email}.`);
      }
    } catch {
      setState({ kind: 'error', message: safeAuthMessage('Network error. Please try again.'), canResend: true });
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title={state.kind === 'success' ? 'Email confirmed' : 'Confirming your email'}
      subtitle={
        state.kind === 'success'
          ? 'Your account is ready.'
          : 'This only takes a moment.'
      }
      footer={
        <>
          Need to sign in?{' '}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Go to login
          </Link>
        </>
      }
    >
      {state.kind === 'working' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Confirming your email&hellip;</p>
        </div>
      )}

      {state.kind === 'success' && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              Your email is confirmed and you&rsquo;re signed in. Welcome to TaskTrack.
            </p>
          </div>
          <Button className="w-full" onClick={() => router.push('/app')}>
            Continue to your dashboard
          </Button>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{state.message}</p>
          </div>

          {notice && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-sm">
              <MailCheck className="w-4 h-4 flex-shrink-0" />
              {notice}
            </div>
          )}

          <div className="space-y-2">
            {state.canResend && (
              <Button onClick={handleResend} disabled={resending} className="w-full" variant="outline">
                {resending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Resend confirmation email
              </Button>
            )}
            <Link href="/signup" className="block">
              <Button className="w-full" variant="ghost">Create a new account</Button>
            </Link>
            <Link href="/login" className="block">
              <Button className="w-full" variant="ghost">Back to login</Button>
            </Link>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
