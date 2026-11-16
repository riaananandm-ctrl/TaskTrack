'use client';

import { supabase } from '@/lib/supabase/client';

export interface ToolAccess {
  unlocked: string[];
  premium: boolean;
  polishUsed: number;
  polishLimit: number;
  resetsAt: string | null;
}

export const EMPTY_ACCESS: ToolAccess = { unlocked: [], premium: false, polishUsed: 0, polishLimit: 3, resetsAt: null };
export const TOOL_ACCESS_EVENT = 'tasktrack:tool-access-changed';

export async function getToolAccess(): Promise<ToolAccess> {
  const { data, error } = await supabase.rpc('get_tool_access');
  if (error || !data || typeof data !== 'object') return EMPTY_ACCESS;
  const d = data as Record<string, unknown>;
  return {
    unlocked: Array.isArray(d.unlocked) ? (d.unlocked as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    premium: d.premium === true,
    polishUsed: typeof d.polishUsed === 'number' ? d.polishUsed : 0,
    polishLimit: typeof d.polishLimit === 'number' ? d.polishLimit : 3,
    resetsAt: typeof d.resetsAt === 'string' ? d.resetsAt : null,
  };
}

export async function redeemCode(code: string): Promise<{ ok: true; tool: string; already: boolean } | { ok: false; error: string }> {
  const clean = code.replace(/\s+/g, '').toUpperCase();
  if (clean.length < 4) return { ok: false, error: 'Type the full code.' };
  const { data, error } = await supabase.rpc('redeem_code', { p_code: clean });
  if (error || !data) return { ok: false, error: 'Couldn’t check that code right now. Please try again.' };
  const d = data as { ok?: boolean; tool?: string; already?: boolean; error?: string };
  if (d.ok && d.tool) {
    window.dispatchEvent(new Event(TOOL_ACCESS_EVENT));
    return { ok: true, tool: d.tool, already: d.already === true };
  }
  if (d.error === 'rate_limited') return { ok: false, error: 'Too many wrong codes. Try again in an hour.' };
  return { ok: false, error: 'That code isn’t valid or has expired.' };
}

export type PolishFocus = 'clarity' | 'grammar' | 'academic' | 'concise';

export interface PolishResult {
  polished: string;
  changes: { before: string; after: string; why: string }[];
  tip: string;
  used: number | null;
  limit: number;
}

export async function polishWriting(
  text: string,
  focus: PolishFocus
): Promise<{ ok: true; result: PolishResult } | { ok: false; error: string; reason?: string }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { data: { session } } = await supabase.auth.getSession();
  if (!base || !session) return { ok: false, error: 'Please sign in again and retry.' };
  try {
    const res = await fetch(`${base}/functions/v1/writing-polish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, Apikey: anon ?? '' },
      body: JSON.stringify({ text, focus }),
    });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!d.ok || typeof d.polished !== 'string') {
      return {
        ok: false,
        error: typeof d.error === 'string' ? d.error : 'Couldn’t polish that right now. Please try again.',
        reason: typeof d.reason === 'string' ? d.reason : undefined,
      };
    }
    return {
      ok: true,
      result: {
        polished: d.polished,
        changes: Array.isArray(d.changes) ? (d.changes as PolishResult['changes']) : [],
        tip: typeof d.tip === 'string' ? d.tip : '',
        used: typeof d.used === 'number' ? d.used : null,
        limit: typeof d.limit === 'number' ? d.limit : 3,
      },
    };
  } catch {
    return { ok: false, error: 'Could not reach TaskTrack. Check your connection and try again.' };
  }
}

export function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}
