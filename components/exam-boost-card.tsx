'use client';

import { useEffect, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { Check, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { announceCreditsChanged } from '@/lib/ai-credits';

interface BoostStatus {
  eligible: boolean;
  task_title?: string;
  due_date?: string;
  credits?: number;
}

/**
 * Exam-week boost: when a test or exam is due within 7 days, every student (Free
 * included) can claim 20 extra AI credits, once a month. Hidden otherwise.
 */
export function ExamBoostCard({ className }: { className?: string }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<BoostStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    supabase.rpc('exam_boost_status').then(({ data }) => {
      if (alive) setStatus((data as BoostStatus | null) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!claimed && !status?.eligible) return null;

  const claim = async () => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('claim_exam_boost');
    setBusy(false);
    const result = data as { ok?: boolean } | null;
    if (e || !result?.ok) {
      setError('Could not add the credits. Please try again.');
      return;
    }
    setClaimed(true);
    announceCreditsChanged();
  };

  const due = status?.due_date ? parseISO(status.due_date) : null;
  const when = due && isValid(due) ? format(due, 'EEE d MMM') : 'soon';

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl border border-violet-300/60 bg-violet-50 p-4 text-sm dark:border-violet-500/30 dark:bg-violet-500/10 ${className ?? ''}`}
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white">
        {claimed ? <Check className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
      </span>
      <div className="min-w-[12rem] flex-1">
        <p className="font-semibold text-violet-900 dark:text-violet-200">
          {claimed ? '20 exam-week credits added' : 'Exam week boost: +20 AI credits'}
        </p>
        <p className="text-violet-900/80 dark:text-violet-100/80">
          {claimed
            ? 'Use them for quizzes and revision before your test. Good luck!'
            : `${status?.task_title ?? 'A test'} is due ${when}. Claim 20 free credits for revision (once a month).`}
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      {!claimed && (
        <Button size="sm" onClick={claim} disabled={busy} className="bg-violet-600 text-white hover:bg-violet-700">
          Claim 20 credits
        </Button>
      )}
    </div>
  );
}
