'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Crown, Gift, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePremiumTrial, logUpgradeViewed, TRIAL_DAYS } from '@/lib/premium-trial';
import { parentAskMessage, PRO_MONTH_PRICE_INR } from '@/lib/premium-contact';

const SHOWN_KEY = 'tasktrack:upgrade-nudge-at';
/** Shown at most once every two days, so it never nags. */
const GAP_MS = 2 * 24 * 60 * 60 * 1000;

/** True when the nudge may be shown now (and records that it was). */
export function claimUpgradeNudgeSlot(): boolean {
  try {
    const last = Number(localStorage.getItem(SHOWN_KEY) || 0);
    if (Date.now() - last < GAP_MS) return false;
    localStorage.setItem(SHOWN_KEY, String(Date.now()));
  } catch {
    // Storage blocked: show it, the student can close it.
  }
  return true;
}

/**
 * Shown to Free students right after a good result (a quiz they did well on, or a new
 * study plan): the moment Premium is most obviously worth it. Offers the free week,
 * the plans page, and a ready-made message to ask a parent.
 */
export function UpgradeNudge({ reason, onClose }: { reason: 'quiz' | 'plan'; onClose: () => void }) {
  const trial = usePremiumTrial();
  const [started, setStarted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    logUpgradeViewed(`nudge_${reason}`);
  }, [reason]);

  const askParent = async () => {
    const text = parentAskMessage(window.location.origin);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'TaskTrack Premium', text });
        return;
      }
    } catch {
      // Share sheet closed or not allowed: fall back to copying.
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked too: nothing else to do quietly.
    }
  };

  const headline =
    reason === 'quiz'
      ? 'Nice quiz! Keep that going with Premium.'
      : 'Your plan is ready. Premium keeps the practice coming.';

  if (started) {
    return (
      <div className="ml-11 flex items-start gap-3 rounded-2xl border border-emerald-300/60 bg-emerald-50 p-4 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
        <p className="flex-1 text-emerald-900 dark:text-emerald-100">
          Premium is on for {TRIAL_DAYS} days: 500 credits a month and every study tool. It switches back to Free by itself.
        </p>
        <button onClick={onClose} aria-label="Close" className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-300">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="ml-11 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm" role="region" aria-label="Premium offer">
      <div className="flex items-start gap-3">
        <Crown className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">{headline}</p>
          <p className="mt-0.5 text-muted-foreground">
            Premium gives you 500 credits a month (about 60 quizzes or plans) from ₹{PRO_MONTH_PRICE_INR} for a month.
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-7">
        {trial.eligible && (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={trial.busy}
            onClick={async () => {
              if (await trial.start()) setStarted(true);
            }}
          >
            <Gift className="h-3.5 w-3.5" /> Try {TRIAL_DAYS} days free
          </Button>
        )}
        <Button asChild size="sm" variant={trial.eligible ? 'outline' : 'default'}>
          <Link href="/app/premium">See plans</Link>
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={askParent}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
          {copied ? 'Message copied' : 'Ask a parent'}
        </Button>
      </div>
      {trial.error && <p className="mt-2 pl-7 text-xs text-red-600">{trial.error}</p>}
    </div>
  );
}
