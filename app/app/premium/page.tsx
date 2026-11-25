'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Crown } from 'lucide-react';
import { PlanComparison } from '@/components/plan-comparison';
import { useAuth } from '@/lib/auth-context';
import { getProfileEntitlements, getPlanLabel, planPriceLine } from '@/lib/entitlements';
import { PremiumUpiCheckout } from '@/components/premium-upi-checkout';
import { PRO_MONTH_PRICE_INR, type PaidPlanId } from '@/lib/premium-contact';
import { Button } from '@/components/ui/button';
import { Gift } from 'lucide-react';
import { usePremiumTrial, logUpgradeViewed, TRIAL_DAYS } from '@/lib/premium-trial';

export default function PremiumPage() {
  const { profile } = useAuth();
  const plan = getProfileEntitlements(profile);
  const planLabel = getPlanLabel(plan);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<PaidPlanId | 'pro_month'>('pro');
  const trial = usePremiumTrial();
  const [trialStarted, setTrialStarted] = useState(false);

  useEffect(() => {
    logUpgradeViewed('plans_page');
  }, []);

  // Paid plans are bought by UPI: pay, enter the UTR, and the team switches it on.
  const handleUpgrade = (p: PaidPlanId | 'pro_month') => {
    setCheckoutPlan(p);
    setCheckoutOpen(true);
  };

  // "Upgrade to Max" links elsewhere in the app land here with ?plan=max.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('plan');
    if (wanted === 'max' || wanted === 'pro' || wanted === 'pro_month') handleUpgrade(wanted);
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
        <p className="text-sm text-muted-foreground mt-1">
          Or Premium for 1 month at ₹{PRO_MONTH_PRICE_INR}{' '}
          <button type="button" onClick={() => handleUpgrade('pro_month')} className="font-medium text-primary underline-offset-2 hover:underline">
            Get 1 month
          </button>
          {' '}· Free stays ₹0
        </p>
        {(trial.eligible || trialStarted) && (
          <div className="mx-auto mt-5 max-w-md rounded-2xl border border-primary/25 bg-primary/5 p-4 text-left">
            {trialStarted ? (
              <p className="text-sm font-medium">Premium is on for {TRIAL_DAYS} days. It switches back to Free by itself, nothing to cancel.</p>
            ) : (
              <>
                <p className="font-semibold">Try Premium free for {TRIAL_DAYS} days</p>
                <p className="mt-0.5 text-sm text-muted-foreground">No payment, nothing renews. One free week per account.</p>
                <Button
                  className="mt-3 gap-1.5"
                  size="sm"
                  disabled={trial.busy}
                  onClick={async () => {
                    if (await trial.start()) setTrialStarted(true);
                  }}
                >
                  <Gift className="h-4 w-4" /> Start my free week
                </Button>
                {trial.error && <p className="mt-2 text-xs text-red-600">{trial.error}</p>}
              </>
            )}
          </div>
        )}
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
