'use client';

import { safeNextPath } from '@/lib/safe-next';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase/client';
import { setRememberDevice } from '@/lib/remember-device';
import { safeAuthMessage } from '@/lib/auth-email';

/** Google's four-colour "G", as required by Google's sign-in branding guidelines. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="w-[18px] h-[18px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

interface GoogleSignInButtonProps {
  /** Where to land after signing in, e.g. from a ?next= parameter. Internal paths only. */
  next?: string | null;
  label?: string;
  onError?: (message: string) => void;
}

/**
 * "Continue with Google". Google has already verified the address, so no confirmation
 * email is needed. Works for both new and existing students: an existing email
 * account with the same address is linked by Supabase automatically.
 */
export function GoogleSignInButton({ next, label = 'Continue with Google', onError }: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);

    // If Google isn't switched on in Supabase, the redirect would land on a raw JSON
    // error page. Check first and explain instead.
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
      });
      const settings = (await res.json()) as { external?: { google?: boolean } };
      if (settings.external?.google === false) {
        setLoading(false);
        onError?.('Google sign-in isn’t switched on yet. Please use your email and password for now.');
        return;
      }
    } catch {
      // If the check itself fails, try the sign-in anyway.
    }

    // Google sign-ins stay signed in on this device, like "Stay logged in" checked.
    setRememberDevice(true);
    const target = new URL('/auth/oauth', window.location.origin);
    const safeNext = safeNextPath(next);
    if (safeNext) target.searchParams.set('next', safeNext);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: target.toString(),
        queryParams: { prompt: 'select_account' },
      },
    });
    // On success the browser is already navigating to Google; only errors return here.
    if (error) {
      setLoading(false);
      const message = error.message.toLowerCase().includes('provider is not enabled')
        ? 'Google sign-in isn’t switched on yet. Please use your email and password for now.'
        : safeAuthMessage(error.message);
      onError?.(message);
    }
  };

  return (
    <Button type="button" variant="outline" className="w-full gap-2" onClick={handleClick} disabled={loading}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleMark />}
      {label}
    </Button>
  );
}

/** "or" separator between the Google button and the email form. */
export function AuthDivider() {
  return (
    <div className="relative my-1" role="separator" aria-label="or">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-background px-3 text-xs uppercase tracking-wider text-muted-foreground">or</span>
      </div>
    </div>
  );
}
