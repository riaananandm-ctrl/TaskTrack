'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { Crown, Loader2, Medal, Trophy, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { XpStreakWidget } from '@/components/xp-streak-widget';
import { cn } from '@/lib/utils';
import {
  getLeaderboard,
  joinLeaderboard,
  leaveLeaderboard,
  XP_WAYS,
  type Leaderboard,
  type LeaderboardScope,
} from '@/lib/leaderboard';

const TABS: { id: LeaderboardScope; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'groups', label: 'My groups' },
  { id: 'all', label: 'All time' },
];

export default function LeaderboardPage() {
  const [scope, setScope] = useState<LeaderboardScope>('week');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: LeaderboardScope) => {
    setError(null);
    try {
      setBoard(await getLeaderboard(s));
    } catch {
      setError('Couldn’t load the leaderboard. Please try again.');
    }
  }, []);

  useEffect(() => {
    load(scope);
  }, [scope, load]);

  const needsNickname = board && !board.nickname && scope !== 'groups';

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
          <Trophy className="h-4 w-4" aria-hidden /> Leaderboard
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Who&rsquo;s learning the most?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Earn XP by getting quiz questions and flashcards right. The weekly board starts fresh every Monday.
        </p>
      </div>

      <XpStreakWidget />

      <div role="tablist" aria-label="Leaderboard" className="flex gap-1 rounded-xl bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={scope === t.id}
            onClick={() => setScope(t.id)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              scope === t.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!board && !error && (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}

      {board && needsNickname && (
        <JoinCard onJoined={() => load(scope)} />
      )}

      {board && (
        <Card className="overflow-hidden">
          {board.me && (scope === 'groups' || board.nickname) && (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-primary/5 px-4 py-3 text-sm">
              <span>
                You&rsquo;re <strong>#{board.me.rank}</strong> with <strong>{board.me.xp} XP</strong>
                {scope === 'week' && ' this week'}
              </span>
              {scope === 'week' && (
                <span className="text-xs text-muted-foreground">
                  Resets in {formatDistanceToNowStrict(parseISO(board.resetsAt))}
                </span>
              )}
            </div>
          )}

          {board.rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {scope === 'groups' ? (
                <>
                  <Users className="mx-auto mb-2 h-6 w-6" aria-hidden />
                  Join or host a <Link href="/app/group" className="font-medium text-primary hover:underline">Group Study</Link> room
                  to compete with your friends.
                </>
              ) : (
                'Nobody is on the board yet. Join and be first!'
              )}
            </div>
          ) : (
            <ol className="divide-y divide-border">
              {board.rows.map((r) => (
                <li
                  key={`${r.rank}-${r.name}`}
                  className={cn('flex items-center gap-3 px-4 py-3', r.me && 'bg-emerald-50 dark:bg-emerald-950/30')}
                >
                  <RankBadge rank={r.rank} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {r.name}
                      {r.me && <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">You</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">Level {r.level}</p>
                  </div>
                  <p className="font-bold tabular-nums">{r.xp} XP</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      <Card className="p-4 sm:p-5">
        <p className="font-semibold">How to earn XP</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {XP_WAYS.map((w) => (
            <li key={w.label} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <span>{w.label}</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300">{w.xp}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Daily limits keep it fair: up to 150 XP a day from quizzes and 60 from flashcards.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm"><Link href="/app/study-sessions">Take a quiz</Link></Button>
          <Button asChild size="sm" variant="outline"><Link href="/app/review">Review flashcards</Link></Button>
        </div>
      </Card>

      {board?.nickname && scope !== 'groups' && (
        <p className="text-center text-xs text-muted-foreground">
          You&rsquo;re on the board as <strong>{board.nickname}</strong>.{' '}
          <button
            className="underline hover:text-foreground"
            onClick={async () => {
              await leaveLeaderboard().catch(() => {});
              load(scope);
            }}
          >
            Leave the leaderboard
          </button>
        </p>
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="h-6 w-6 text-amber-500" aria-label="1st" />;
  if (rank === 2) return <Medal className="h-6 w-6 text-slate-400" aria-label="2nd" />;
  if (rank === 3) return <Medal className="h-6 w-6 text-amber-700" aria-label="3rd" />;
  return <span className="w-6 text-center text-sm font-semibold text-muted-foreground tabular-nums">{rank}</span>;
}

function JoinCard({ onJoined }: { onJoined: () => void }) {
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await joinLeaderboard(nick);
      if (res.ok) onJoined();
      else setError(res.error ?? 'Couldn’t join. Try another nickname.');
    } catch {
      setError('Couldn’t join. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5 p-4 sm:p-5">
      <p className="font-semibold">Join the leaderboard</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a nickname. Other students only see this nickname and your XP, never your real name or school.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="e.g. QuizWizard"
          maxLength={20}
          aria-label="Nickname"
          className="sm:max-w-xs"
        />
        <Button type="submit" disabled={busy || nick.trim().length < 3}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join'}
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Card>
  );
}
