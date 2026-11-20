'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Clock, Copy, Loader2, MessageCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import {
  PAID_PLAN_NAME,
  PLAN_PRICE_INR,
  PREMIUM_UPI_NUMBER,
  type PaidPlanId,
  openPremiumWhatsApp,
  premiumPaidMessage,
} from '@/lib/premium-contact';

interface PremiumRequest {
  utr: string;
  plan: PaidPlanId;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

const ERRORS: Record<string, string> = {
  bad_utr: 'That doesn’t look like a UTR. It’s the 12-digit number (sometimes letters too) on your UPI receipt.',
  duplicate: 'That UTR has already been sent. If it’s yours, message us on WhatsApp and we’ll sort it out.',
  already_pending: 'You already have a payment being checked. We’ll switch your plan on soon.',
  bad_plan: 'Choose Premium or Max first.',
  too_many: 'Too many tries today. Please message us on WhatsApp instead.',
  auth: 'Please sign in again and retry.',
};

const PLAN_POINTS: Record<PaidPlanId, string> = {
  pro: '500 AI credits a month, whiteboard tutor, AI Detector',
  max: '1,000 AI credits a month, everything in Premium, plus Rewrite Coach',
};

/** Pay by UPI, enter the UTR, then tell the team on WhatsApp. */
export function PremiumUpiCheckout({
  open,
  onOpenChange,
  initialPlan = 'pro',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialPlan?: PaidPlanId;
}) {
  const { user } = useAuth();
  const [plan, setPlan] = useState<PaidPlanId>(initialPlan);
  const price = PLAN_PRICE_INR[plan];
  const name = PAID_PLAN_NAME[plan];
  const [utr, setUtr] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PremiumRequest | null>(null);

  const loadPending = useCallback(async () => {
    const { data } = await supabase
      .from('premium_requests')
      .select('utr, plan, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setPending((data as PremiumRequest | null) ?? null);
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setPlan(initialPlan);
      loadPending();
    }
  }, [open, loadPending, initialPlan]);

  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(PREMIUM_UPI_NUMBER);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the number is on screen to copy by hand.
    }
  };

  const submit = async () => {
    const clean = utr.replace(/\s/g, '').toUpperCase();
    if (!/^[0-9A-Z]{6,35}$/.test(clean)) {
      setError(ERRORS.bad_utr);
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('request_premium', { p_utr: clean, p_plan: plan });
    setBusy(false);
    const row = Array.isArray(data) ? data[0] : data;
    if (rpcError || !row) {
      setError('Something went wrong. Please try again, or message us on WhatsApp.');
      return;
    }
    if (!row.ok) {
      setError(ERRORS[row.code] ?? 'Something went wrong. Please try again.');
      if (row.code === 'already_pending') loadPending();
      return;
    }
    setUtr('');
    await loadPending();
    // Let the team know straight away.
    openPremiumWhatsApp(premiumPaidMessage(clean, user?.email, plan));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Get {pending ? PAID_PLAN_NAME[pending.plan] : name}</DialogTitle>
          <DialogDescription>Paid once for 3 months. It never renews by itself.</DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">We’re checking your payment</p>
                <p className="mt-1">
                  This takes a few hours. Your {PAID_PLAN_NAME[pending.plan]} plan will be switched on by the end of today.
                  UTR {pending.utr}.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => openPremiumWhatsApp(premiumPaidMessage(pending.utr, user?.email, pending.plan))}
            >
              <MessageCircle className="mr-2 h-4 w-4" /> Message us on WhatsApp
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Choose a plan">
              {(['pro', 'max'] as PaidPlanId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={plan === id}
                  onClick={() => setPlan(id)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    plan === id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="block text-sm font-semibold">{PAID_PLAN_NAME[id]}</span>
                  <span className="block text-lg font-bold">₹{PLAN_PRICE_INR[id]}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{PLAN_POINTS[id]}</span>
                </button>
              ))}
            </div>

            <div>
              <p className="text-sm font-semibold">1. Pay ₹{price} by UPI</p>
              <p className="mt-1 text-xs text-muted-foreground">
                In any UPI app (GPay, PhonePe, Paytm, FamPay…), choose “Pay to UPI number” or pay to this phone number:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="flex-1 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-base tracking-wide">
                  {PREMIUM_UPI_NUMBER}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={copyUpi}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span className="ml-1.5">{copied ? 'Copied' : 'Copy'}</span>
                </Button>
              </div>
            </div>

            <div>
              <label htmlFor="premium-utr" className="text-sm font-semibold">
                2. Enter the UTR from your receipt
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                The 12-digit UPI reference number (also called UTR or transaction ID) shown after you pay.
              </p>
              <Input
                id="premium-utr"
                className="mt-2 font-mono"
                inputMode="text"
                autoComplete="off"
                placeholder="e.g. 431298765432"
                value={utr}
                maxLength={40}
                onChange={(e) => setUtr(e.target.value)}
              />
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>

            <Button className="w-full" onClick={submit} disabled={busy || !utr.trim()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              I’ve paid: check my payment
            </Button>
            <p className="text-[11px] leading-4 text-muted-foreground">
              WhatsApp opens with a message to TaskTrack; press send so we can find your payment. {name} is usually on
              within a few hours, and always by the end of the day. Never share your UPI PIN or OTP. See our{' '}
              <Link href="/refund-policy" className="underline">refund policy</Link>.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
