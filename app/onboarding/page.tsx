'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { BrandLoading } from '@/components/brand-loading';

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
    return <BrandLoading label="Redirecting..." />;
  }

  return null;
}
