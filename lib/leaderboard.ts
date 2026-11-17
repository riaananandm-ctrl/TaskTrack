'use client';

import { supabase } from '@/lib/supabase/client';

export type LeaderboardScope = 'week' | 'all' | 'groups';

export interface LeaderboardRow {
  rank: number;
  name: string;
  xp: number;
  level: number;
  me: boolean;
}

export interface Leaderboard {
  scope: LeaderboardScope;
  nickname: string | null;
  rows: LeaderboardRow[];
  me: { rank: number; xp: number } | null;
  myWeekXp: number;
  resetsAt: string;
}

export async function getLeaderboard(scope: LeaderboardScope): Promise<Leaderboard> {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_scope: scope });
  if (error) throw error;
  return data as Leaderboard;
}

export async function joinLeaderboard(nickname: string): Promise<{ ok: boolean; error?: string; nickname?: string }> {
  const { data, error } = await supabase.rpc('join_leaderboard', { p_nickname: nickname });
  if (error) throw error;
  return data as { ok: boolean; error?: string; nickname?: string };
}

export async function leaveLeaderboard(): Promise<void> {
  const { error } = await supabase.rpc('leave_leaderboard');
  if (error) throw error;
}

/** How each kind of learning earns XP. Mirrors the database triggers and award_xp. */
export const XP_WAYS = [
  { label: 'Quiz: each correct answer', xp: '+5' },
  { label: 'Quiz: perfect score bonus', xp: '+10' },
  { label: 'Flashcard answered right', xp: '+3' },
  { label: 'Task completed', xp: '+20' },
  { label: '25-minute focus session', xp: '+30' },
];
