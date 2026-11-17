'use client';

import { supabase } from '@/lib/supabase/client';

export interface ToolAccess {
  unlocked: string[];
  premium: boolean;
  polishUsed: number;
  polishLimit: number;
  detectorUsed: number;
  detectorLimit: number;
  resetsAt: string | null;
}

export const EMPTY_ACCESS: ToolAccess = { unlocked: [], premium: false, polishUsed: 0, polishLimit: 3, detectorUsed: 0, detectorLimit: 5, resetsAt: null };
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
    detectorUsed: typeof d.detectorUsed === 'number' ? d.detectorUsed : 0,
    detectorLimit: typeof d.detectorLimit === 'number' ? d.detectorLimit : 5,
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

export function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export interface DetectResult {
  score: number;
  band: 'likely_ai' | 'mixed' | 'likely_human';
  sentences: { text: string; ai: number | null }[];
  reasons: string[];
  stats: { words: number; sentences: number; avgSentenceLength: number; sentenceVariation: number; vocabularyVariety: number };
}

export async function detectAi(text: string): Promise<{ ok: true; result: DetectResult } | { ok: false; error: string }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { data: { session } } = await supabase.auth.getSession();
  if (!base || !session) return { ok: false, error: 'Please sign in again and retry.' };
  try {
    const res = await fetch(`${base}/functions/v1/ai-detector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, Apikey: anon ?? '' },
      body: JSON.stringify({ text }),
    });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!d.ok || typeof d.score !== 'number') {
      return { ok: false, error: typeof d.error === 'string' ? d.error : 'Couldn’t check that right now. Please try again.' };
    }
    return { ok: true, result: d as unknown as DetectResult };
  } catch {
    return { ok: false, error: 'Could not reach TaskTrack. Check your connection and try again.' };
  }
}
