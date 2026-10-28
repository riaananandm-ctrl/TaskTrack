'use client';

import { useState } from 'react';
import { Sparkles, Crown } from 'lucide-react';
import { PlanComparison } from '@/components/plan-comparison';
import { useAuth } from '@/lib/auth-context';
import { getProfileEntitlements, getPlanLabel, planPriceLine } from '@/lib/entitlements';

export default function PremiumPage() {
  const { profile } = useAuth();
  const plan = getProfileEntitlements(profile);
  const planLabel = getPlanLabel(plan);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrading] = useState(false);

  // Payment processing is not connected yet. This must not claim a purchase
  // succeeded — it only records intent so the real checkout can be wired in.
  const handleUpgrade = () => {
    setNotice(
      'Checkout isn\u2019t connected yet, so no payment has been taken and no charge will be made. Your plan is unchanged.'
    );
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl gradient-blue flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Plans</h1>
        <p className="text-lg text-muted-foreground mt-2">
          Simple pricing. Upgrade any time.
        </p>
        <p className="text-2xl font-bold tracking-tight mt-3">Premium — ₹699 for 3 months</p>
        <p className="text-sm text-muted-foreground mt-1">Free stays ₹0</p>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 mt-4">
          <Crown className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
          <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
            You&rsquo;re on the {planLabel} plan ({planPriceLine(plan)})
          </span>
        </div>
      </div>

      <PlanComparison
        onUpgrade={handleUpgrade}
        upgrading={upgrading}
        upgradeNotice={notice}
      />

      <p className="text-xs text-muted-foreground text-center pb-4">
        Prices shown in Indian rupees. No payment processing is active yet — no charges will be made.
      </p>
    </div>
  );
}
