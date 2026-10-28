'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Flame, Zap, Trophy } from 'lucide-react';
import { levelForXp, xpForNextLevel, GamificationStats } from '@/lib/gamification';
import { cn } from '@/lib/utils';

export function XpStreakWidget({ className, compact }: { className?: string; compact?: boolean }) {
  const [stats, setStats] = useState<GamificationStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const [xpRes, streaksRes, badgesRes] = await Promise.all([
        supabase.from('user_xp').select('total_xp, level').maybeSingle(),
        supabase.from('user_streaks').select('current_streak, longest_streak').maybeSingle(),
        supabase.from('user_badges').select('badge_key'),
      ]);

      setStats({
        totalXp: xpRes.data?.total_xp ?? 0,
        level: xpRes.data?.level ?? 1,
        currentStreak: streaksRes.data?.current_streak ?? 0,
        longestStreak: streaksRes.data?.longest_streak ?? 0,
        badges: (badgesRes.data ?? []).map((b: { badge_key: string }) => b.badge_key),
      });
    } catch {
      // Non-critical: widget just shows zeros.
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const level = stats ? levelForXp(stats.totalXp) : 1;
  const xpToNext = stats ? xpForNextLevel(stats.totalXp) : 0;
  const progressPct = stats ? Math.min(100, Math.round((1 - xpToNext / Math.pow(level * 5, 2)) * 100)) : 0;

  if (compact) {
    return (
      <Card className={cn('p-3', className)}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4.5 h-4.5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Lv {level}</span>
              <span className="text-xs text-muted-foreground">{stats?.totalXp ?? 0} XP</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Flame className="w-4 h-4 text-orange-600" />
            <span className="text-xs font-bold">{stats?.currentStreak ?? 0}</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
            <Zap className="w-6 h-6 text-amber-600" />
          </div>
          <p className="text-xs font-medium text-muted-foreground mt-1">Level</p>
          <p className="text-lg font-bold">{level}</p>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold">{stats?.totalXp ?? 0} XP</span>
            <span className="text-xs text-muted-foreground">{xpToNext} XP to next level</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div className="w-12 h-12 rounded-xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center">
            <Flame className="w-6 h-6 text-orange-600" />
          </div>
          <p className="text-xs font-medium text-muted-foreground mt-1">Streak</p>
          <p className="text-lg font-bold">{stats?.currentStreak ?? 0}</p>
        </div>

        {stats && stats.badges.length > 0 && (
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-emerald-600" />
            </div>
            <p className="text-xs font-medium text-muted-foreground mt-1">Badges</p>
            <p className="text-lg font-bold">{stats.badges.length}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
