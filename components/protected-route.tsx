'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { BrandLoading } from '@/components/brand-loading';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, emailConfirmed } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
    // A user who is signed in but unconfirmed is sent to login with a notice.
    if (!loading && user && !emailConfirmed) {
      router.push('/login?message=confirm');
    }
  }, [user, loading, emailConfirmed, router]);

  if (loading || !user || !emailConfirmed) {
    return <BrandLoading />;
  }

  return <>{children}</>;
}
