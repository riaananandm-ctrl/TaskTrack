'use client';

import { supabase } from '@/lib/supabase/client';

export interface StudyGroup {
  id: string;
  host_id: string;
  name: string;
  topic: string | null;
  join_code: string;
  ended_at: string | null;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  display_name: string;
  joined_at: string;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  kind: 'user' | 'ai' | 'system';
  content: string;
  created_at: string;
}

export const MAX_GROUP_MEMBERS = 8;
export const MAX_MESSAGE_CHARS = 1000;

const ERRORS: Record<string, string> = {
  group_not_found: 'No active group has that code. Check it with your host.',
  group_full: `That group is full (${MAX_GROUP_MEMBERS} people).`,
  too_many_groups: 'You already host 5 active groups. End one before starting another.',
  name_required: 'Give your group a name.',
  not_signed_in: 'Please sign in again and retry.',
  parent_consent_required: 'A parent or guardian needs to OK Group Study first. Make a link for them at the top of this page.',
  age_check_required: 'Please finish the quick age check at the top of this page first.',
  consent_required: 'Please accept the Terms of Service first, then try again.',
};

function friendly(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const key = Object.keys(ERRORS).find((k) => message.includes(k));
  if (key) return ERRORS[key];
  // The tables do not exist until the group-study migration has been applied.
  if (/does not exist|schema cache|PGRST20/i.test(message)) return 'Group study isn’t switched on yet. Please try again later.';
  return fallback;
}

/** Codes are shown as "ABC-123" but stored without the dash. */
export function formatCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.length > 3 ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}` : clean;
}

export async function createGroup(name: string, topic: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('create_study_group', { p_name: name, p_topic: topic || null });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.id) return { ok: false, error: friendly(error?.message, 'We couldn’t start the group. Please try again.') };
  return { ok: true, id: row.id as string };
}

export async function joinGroup(code: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('join_study_group', { p_code: code });
  if (error || typeof data !== 'string') return { ok: false, error: friendly(error?.message, 'We couldn’t join that group. Please try again.') };
  return { ok: true, id: data };
}

export async function endGroup(groupId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('end_study_group', { p_group: groupId });
  return !error && data === true;
}

export async function leaveGroup(groupId: string, userId: string): Promise<boolean> {
  const { error } = await supabase.from('study_group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  return !error;
}

/** Groups the student belongs to, newest first. `error` is set when the feature is unavailable. */
export async function listMyGroups(): Promise<{ groups: StudyGroup[]; error: string | null }> {
  const { data, error } = await supabase.from('study_groups').select('*').order('created_at', { ascending: false }).limit(30);
  if (error) return { groups: [], error: friendly(error.message, 'We couldn’t load your groups. Please refresh.') };
  return { groups: (data as StudyGroup[]) || [], error: null };
}

export async function loadRoom(groupId: string): Promise<{ group: StudyGroup | null; members: GroupMember[]; messages: GroupMessage[] }> {
  const [g, m, msg] = await Promise.all([
    supabase.from('study_groups').select('*').eq('id', groupId).maybeSingle(),
    supabase.from('study_group_members').select('*').eq('group_id', groupId).order('joined_at'),
    supabase.from('study_group_messages').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(200),
  ]);
  return {
    group: (g.data as StudyGroup) || null,
    members: (m.data as GroupMember[]) || [],
    messages: ((msg.data as GroupMessage[]) || []).reverse(),
  };
}

export async function sendMessage(groupId: string, userId: string, displayName: string, content: string): Promise<boolean> {
  const { error } = await supabase
    .from('study_group_messages')
    .insert({ group_id: groupId, user_id: userId, display_name: displayName, kind: 'user', content: content.slice(0, MAX_MESSAGE_CHARS) });
  return !error;
}

export type ReportReason = 'bullying' | 'inappropriate' | 'personal_info' | 'spam' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'bullying', label: 'Bullying or mean' },
  { value: 'inappropriate', label: 'Inappropriate or rude' },
  { value: 'personal_info', label: 'Sharing personal info' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
];

/** Report someone else's message. Reports are private and reviewed by the TaskTrack team. */
export async function reportMessage(messageId: string, reason: ReportReason, details?: string): Promise<string | null> {
  const { error } = await supabase.rpc('report_study_message', {
    p_message: messageId,
    p_reason: reason,
    p_details: details ?? null,
  });
  if (!error) return null;
  if (error.message.includes('own_message')) return 'You can’t report your own message.';
  return 'We couldn’t send the report. Please try again.';
}
