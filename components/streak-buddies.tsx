'use client';

import { useCallback, useEffect, useState } from 'react';
import { Flame, Loader2, UserPlus, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  listBuddies, listBuddyCandidates, removeBuddy, requestBuddy, respondBuddy, getMyStreak,
  type Buddy, type MyStreak,
} from '@/lib/ib-data';

/**
 * Study streak buddies: pair up with someone from your study groups and keep a
 * joint streak going. A day counts when you finish a task, review flashcards,
 * study with the AI or tick off a revision session. Buddies only see each
 * other's first name, whether each studied today, and the shared streak.
 */
export function StreakBuddies() {
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [me, setMe] = useState<MyStreak | null>(null);
  const [candidates, setCandidates] = useState<{ user_id: string; first_name: string }[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([listBuddies(), getMyStreak()]);
      setBuddies(b);
      setMe(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your buddies could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      if (candidates) setCandidates(await listBuddyCandidates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const showCandidates = async () => {
    setBusy('candidates');
    try {
      setCandidates(await listBuddyCandidates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your study group members could not be loaded.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4" aria-labelledby="buddies-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="buddies-heading" className="text-lg font-semibold flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500" /> Streak buddies
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-xl">
            Keep a streak going with a friend from your groups. A day counts when you both study: finish a task, review
            cards, study with the AI or tick off a revision session.
          </p>
        </div>
        {me && (
          <div className="text-right">
            <p className="text-2xl font-bold leading-none">{me.current_streak}<span className="text-sm font-medium text-muted-foreground"> day{me.current_streak === 1 ? '' : 's'}</span></p>
            <p className="text-xs text-muted-foreground mt-1">{me.studied_today ? 'You studied today ✓' : 'Study today to keep it'}</p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          {buddies.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {buddies.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold', b.status === 'active' && b.shared_streak > 0 ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' : 'bg-muted text-muted-foreground')}>
                    {b.status === 'active' ? b.shared_streak : '…'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{b.first_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.status === 'pending'
                        ? b.incoming ? 'Wants to be your streak buddy' : 'Request sent'
                        : `${b.shared_streak}-day shared streak · ${b.me_today ? 'you ✓' : 'you: not yet'} · ${b.buddy_today ? `${b.first_name} ✓` : `${b.first_name}: not yet`}`}
                    </p>
                  </div>
                  {b.incoming ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" disabled={busy === b.id} onClick={() => run(b.id, () => respondBuddy(b.id, true))} className="gap-1"><Check className="w-3.5 h-3.5" /> Accept</Button>
                      <Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => run(b.id, () => respondBuddy(b.id, false))} aria-label={`Decline ${b.first_name}`}><X className="w-3.5 h-3.5" /></Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => run(b.id, () => removeBuddy(b.id))}
                      disabled={busy === b.id}
                      aria-label={b.status === 'pending' ? `Cancel request to ${b.first_name}` : `Remove ${b.first_name} as a buddy`}
                      className="tap-target p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {candidates === null ? (
            <Button variant="outline" size="sm" onClick={showCandidates} disabled={busy === 'candidates'} className="gap-1.5">
              <UserPlus className="w-4 h-4" /> Add a buddy
            </Button>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one to add yet. Buddies come from your study groups, so invite a friend to a group first.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">People from your study groups</p>
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <Button key={c.user_id} size="sm" variant="outline" disabled={busy === c.user_id} onClick={() => run(c.user_id, () => requestBuddy(c.user_id))} className="gap-1.5">
                    <UserPlus className="w-3.5 h-3.5" /> {c.first_name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
