'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { Lock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { getProfileEntitlements, type PlanEntitlements } from '@/lib/entitlements';

interface ProFeatureGateProps {
  /** The entitlement key that unlocks this feature. */
  feature: keyof PlanEntitlements;
  title: string;
  description: string;
  children: ReactNode;
}

/**
 * Renders `children` when the signed-in user's plan includes `feature`; otherwise
 * shows a locked card prompting an upgrade. Plan resolution goes through the
 * central entitlements module so gating stays consistent everywhere.
 */
export function ProFeatureGate({ feature, title, description, children }: ProFeatureGateProps) {
  const { profile } = useAuth();
  const entitlements = getProfileEntitlements(profile);
  const unlocked = Boolean(entitlements[feature]);

  if (unlocked) return <>{children}</>;

  return (
    <div
      className={cn(
        'relative rounded-xl border border-dashed border-blue-200 dark:border-blue-900',
        'bg-gradient-to-br from-slate-50 to-blue-50/40 dark:from-slate-950 dark:to-blue-950/20 p-6'
      )}
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center flex-shrink-0">
          <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{title}</h3>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400">
              Premium
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
          <Link
            href="/app/premium"
            className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-primary hover:underline"
          >
            <Sparkles className="w-3.5 h-3.5" /> Upgrade to Premium — ₹699 for 3 months
          </Link>
        </div>
      </div>
    </div>
  );
}
