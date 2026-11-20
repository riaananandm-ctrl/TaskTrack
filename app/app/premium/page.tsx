'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Crown } from 'lucide-react';
import { PlanComparison } from '@/components/plan-comparison';
import { useAuth } from '@/lib/auth-context';
import { getProfileEntitlements, getPlanLabel, planPriceLine } from '@/lib/entitlements';
import { PremiumUpiCheckout } from '@/components/premium-upi-checkout';
import type { PaidPlanId } from '@/lib/premium-contact';

export default function PremiumPage() {
  const { profile } = useAuth();
  const plan = getProfileEntitlements(profile);
  const planLabel = getPlanLabel(plan);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<PaidPlanId>('pro');

  // Paid plans are bought by UPI: pay, enter the UTR, and the team switches it on.
  const handleUpgrade = (p: PaidPlanId) => {
    setCheckoutPlan(p);
    setCheckoutOpen(true);
  };

  // "Upgrade to Max" links elsewhere in the app land here with ?plan=max.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('plan');
    if (wanted === 'max' || wanted === 'pro') handleUpgrade(wanted);
  }, []);

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl gradient-blue flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Plans</h1>
        <p className="text-lg text-muted-foreground mt-2">
          Simple pricing. Upgrade any time.
        </p>
        <p className="text-2xl font-bold tracking-tight mt-3">Premium ₹499 · Max ₹999 <span className="text-base font-medium text-muted-foreground">for 3 months</span></p>
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
      />
      <PremiumUpiCheckout open={checkoutOpen} onOpenChange={setCheckoutOpen} initialPlan={checkoutPlan} />

      <p className="text-xs text-muted-foreground text-center pb-4">
        Prices shown in Indian rupees. Premium and Max are paid by UPI and switched on by the TaskTrack team, usually within a few hours.
      </p>
    </div>
  );
}
