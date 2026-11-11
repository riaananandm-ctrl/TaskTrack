'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { levelForXp, xpForNextLevel, GamificationStats } from '@/lib/gamification';
import { cn } from '@/lib/utils';
import { LevelIcon, StreakIcon, BadgeIcon } from '@/components/brand-icons';

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
          <LevelIcon size={26} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Lv {level}</span>
              <span className="text-xs text-muted-foreground">{stats?.totalXp ?? 0} XP</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#3B6FF0] via-[#14B8A6] to-[#62CC6A] transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <StreakIcon size={18} />
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
          <LevelIcon size={36} />
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
              className="h-full rounded-full bg-gradient-to-r from-[#3B6FF0] via-[#14B8A6] to-[#62CC6A] transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col items-center">
          <StreakIcon size={36} />
          <p className="text-xs font-medium text-muted-foreground mt-1">Streak</p>
          <p className="text-lg font-bold">{stats?.currentStreak ?? 0}</p>
        </div>

        {stats && stats.badges.length > 0 && (
          <div className="flex flex-col items-center">
            <BadgeIcon size={36} />
            <p className="text-xs font-medium text-muted-foreground mt-1">Badges</p>
            <p className="text-lg font-bold">{stats.badges.length}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
