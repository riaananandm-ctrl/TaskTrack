'use client';

import { useRef, useEffect, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { Loader2, AlertCircle, MailCheck, RefreshCw } from 'lucide-react';
import { safeAuthMessage, SIGNIN_EMAIL_STORAGE_KEY } from '@/lib/auth-email';
import { CHECK_EMAIL_FOR_RESET_MESSAGE } from '@/lib/password-recovery';

/**
 * Request a password reset email.
 *
 * The wording is deliberately identical whether or not the address has an account, so
 * the screen never reveals who is registered. The link is always built from the origin
 * the student is actually using, so it works in Preview and production alike.
 */
export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [email, setEmail] = useState('');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // One in-flight request per form: double clicks and re-submits are ignored.
    if (inFlight.current) return;
    if (loading) return;
    inFlight.current = true;
    setError(null);
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(safeAuthMessage(resetError.message));
      setLoading(false);
      inFlight.current = false;
      return;
    }

    setSentTo(email);
    setLoading(false);
    inFlight.current = false;
  };

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="We sent you a link to reset your password."
        footer={
          <>
            Remember your password?{' '}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Log in
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
              <p className="text-sm font-semibold text-foreground">{CHECK_EMAIL_FOR_RESET_MESSAGE}</p>
              <p className="text-sm text-muted-foreground mt-1 break-words">
                We sent a reset link to <span className="font-medium text-foreground">{sentTo}</span>.
                Open it to choose a new password.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setSentTo(null); setError(null); }}
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Send again
            </Button>
            <Link href="/login" className="block">
              <Button variant="ghost" className="w-full">Back to login</Button>
            </Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot password"
      subtitle="We&rsquo;ll send you a link to reset your password."
      footer={
        <>
          Remember your password?{' '}
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
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="alex@school.edu"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {loading ? 'Sending\u2026' : 'Send reset link'}
        </Button>
        <Link href="/login" className="block">
          <Button type="button" variant="ghost" className="w-full">Back to login</Button>
        </Link>
      </form>
    </AuthLayout>
  );
}
