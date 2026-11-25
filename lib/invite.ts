import { supabase } from '@/lib/supabase/client';

/**
 * Invite a friend. Each student has a short code; their link is <site>/?ref=i-<code>.
 * The signup-ref flow (lib/signup-ref.ts) carries it through sign-up, and
 * record_signup_ref gives the friend and the inviter 50 extra AI credits each,
 * for up to 20 friends.
 */
export interface MyInvite {
  code: string;
  friendsJoined: number;
  maxRewarded: number;
  rewardCredits: number;
}

export async function getMyInvite(): Promise<MyInvite> {
  const { data, error } = await supabase.rpc('get_my_invite');
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.code) throw new Error('Your invite link could not be loaded.');
  return {
    code: row.code,
    friendsJoined: row.friends_joined ?? 0,
    maxRewarded: row.max_rewarded ?? 20,
    rewardCredits: row.reward_credits ?? 50,
  };
}

export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, '')}/?ref=i-${code}`;
}

export function inviteMessage(link: string, credits: number): string {
  return `I use TaskTrack for ManageBac deadlines and revision. Sign up with my link and we both get ${credits} extra AI credits: ${link}`;
}
