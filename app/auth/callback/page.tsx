'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Auth callback route — the redirect target for Supabase Auth emails.
 *
 * Supabase confirmation and recovery links can be configured to redirect here.
 * This page simply forwards the full URL (query + fragment) to /auth/confirm,
 * which handles all token types (signup, recovery, email change). A separate
 * route is kept so the redirect URL allow-list can list /auth/callback.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const search = window.location.search;
    const hash = window.location.hash;
    const target = `/auth/confirm${search}${hash}`;
    router.replace(target);
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-sm text-muted-foreground">Redirecting...</p>
    </div>
  );
}
