'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { peekLastRoute, resolveResumeRoute } from '@/lib/last-route';
import { isRecoveryActive } from '@/lib/password-recovery';

/**
 * Resumes a signed-in student's last screen when they land back on the landing page
 * (a reopened tab, a discarded tab, a fresh PWA launch). Renders nothing and never
 * touches routes under /app, auth pages, or an active recovery flow; every decision
 * waits until the auth state is known and passes through resolveResumeRoute.
 */
export function LastRouteResume() {
  const { user, loading, emailConfirmed } = useAuth();
  const router = useRouter();
  const [recoveryActive, setRecoveryActive] = useState(false);

  useEffect(() => {
    setRecoveryActive(isRecoveryActive());
  }, []);

  useEffect(() => {
    const decision = resolveResumeRoute({
      pathname: window.location.pathname,
      authenticated: !!user,
      emailConfirmed,
      loading,
      recoveryActive,
      stored: peekLastRoute(),
    });
    if (decision) router.replace(decision);
  }, [user, loading, emailConfirmed, recoveryActive, router]);

  return null;
}
