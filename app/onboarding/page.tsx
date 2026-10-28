'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Logo } from '@/components/logo';

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace('/starter');
    }
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="flex items-center justify-center rounded-2xl bg-white p-3 shadow-soft dark:bg-slate-900">
          <Logo size={52} showText={false} />
        </div>
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  return null;
}
