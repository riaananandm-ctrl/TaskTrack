'use client';

import { safeNextPath } from '@/lib/safe-next';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { AuthLayout } from '@/components/auth-layout';
import { BrandLoading } from '@/components/brand-loading';
import { Button } from '@/components/ui/button';
import { markPersistentLogin } from '@/lib/auth-storage';
import { peekLastRoute } from '@/lib/last-route';

/**
 * Return page for "Continue with Google". Supabase sends the student back here with
 * their session in the URL; the client picks it up (detectSessionInUrl) and we move on
 * to the app. Kept separate from /auth/confirm, which is worded for email links.
 */
export default function OAuthReturnPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const problem = url.searchParams.get('error_description') || hash.get('error_description');
    if (problem) {
      setError('Google sign-in was cancelled or didn’t finish. Please try again.');
      return;
    }

    const go = () => {
      if (settled) return;
      settled = true;
      markPersistentLogin();
      const next = url.searchParams.get('next');
      const safeNext = safeNextPath(next);
      // Full navigation so the app starts with the freshly stored session.
      window.location.replace(safeNext || peekLastRoute() || '/app');
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) go();
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go();
    });
    const timer = window.setTimeout(() => {
      if (!settled) setError('We couldn’t finish signing you in with Google. Please try again.');
    }, 10_000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  if (!error) return <BrandLoading label="Signing you in with Google" />;

  return (
    <AuthLayout title={'Sign-in didn’t finish'} subtitle="Nothing was changed on your account.">
      <div className="space-y-4">
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
        <Link href="/login" className="block">
          <Button className="w-full">Back to log in</Button>
        </Link>
      </div>
    </AuthLayout>
  );
}
