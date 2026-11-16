'use client';

import { supabase } from '@/lib/supabase/client';

/**
 * Google Classroom import. The browser only ever asks the `google-classroom` function to
 * start, sync or disconnect; the Google tokens live (encrypted) on the server.
 */

export interface ClassroomStatus {
  connected: boolean;
  needsReconnect: boolean;
  googleEmail: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncImported: number;
}

interface FunctionResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function callClassroom(body: Record<string, unknown>): Promise<FunctionResult> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { data: { session } } = await supabase.auth.getSession();
  if (!base || !session) return { ok: false, error: 'Please sign in again and retry.' };
  try {
    const res = await fetch(`${base}/functions/v1/google-classroom`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        Apikey: anon ?? '',
      },
      body: JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => null);
    return parsed && typeof parsed === 'object' ? (parsed as FunctionResult) : { ok: false, error: 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, error: 'Could not reach TaskTrack. Check your connection and try again.' };
  }
}

export async function getClassroomStatus(): Promise<ClassroomStatus> {
  const { data } = await supabase
    .from('google_classroom_connections')
    .select('google_email, status, last_sync_at, last_sync_status, last_sync_error, last_sync_imported')
    .maybeSingle();
  return {
    connected: Boolean(data),
    needsReconnect: data?.status === 'reconnect',
    googleEmail: data?.google_email ?? null,
    lastSyncAt: data?.last_sync_at ?? null,
    lastSyncStatus: data?.last_sync_status ?? null,
    lastSyncError: data?.last_sync_error ?? null,
    lastSyncImported: data?.last_sync_imported ?? 0,
  };
}

/** Send the student to Google's consent screen. Only returns if something went wrong. */
export async function startClassroomConnect(): Promise<string> {
  const result = await callClassroom({ action: 'start' });
  if (result.ok && typeof result.url === 'string' && result.url.startsWith('https://accounts.google.com/')) {
    window.location.href = result.url;
    return '';
  }
  return result.error ?? 'Google Classroom could not be connected. Please try again.';
}

export async function syncClassroom(): Promise<{ ok: boolean; error?: string; imported?: number; updated?: number; completed?: number }> {
  const r = await callClassroom({ action: 'sync' });
  return {
    ok: r.ok,
    error: r.error,
    imported: typeof r.imported === 'number' ? r.imported : 0,
    updated: typeof r.updated === 'number' ? r.updated : 0,
    completed: typeof r.completed === 'number' ? r.completed : 0,
  };
}

export async function disconnectClassroom(): Promise<{ ok: boolean; error?: string }> {
  const r = await callClassroom({ action: 'disconnect' });
  return { ok: r.ok, error: r.error };
}

/** What to tell the student when Google sends them back with ?classroom=… */
export const RETURN_MESSAGES: Record<string, { kind: 'ok' | 'error' | 'info'; text: string }> = {
  connected: { kind: 'ok', text: 'Google Classroom connected. Your assignments with due dates are being imported.' },
  cancelled: { kind: 'info', text: 'Google Classroom was not connected because the permission was cancelled.' },
  blocked: {
    kind: 'error',
    text: 'Google blocked the connection. School accounts often need the school IT admin to allow TaskTrack first. Ask them, or try a personal Google account.',
  },
  scopes: { kind: 'error', text: 'TaskTrack needs both Classroom permissions ticked to import your work. Please connect again and allow both.' },
  expired: { kind: 'error', text: 'That connection attempt expired. Please press Connect Google Classroom again.' },
  unavailable: { kind: 'error', text: 'Google Classroom is not set up on TaskTrack yet. Please try again later.' },
  failed: { kind: 'error', text: 'Google Classroom could not be connected. Please try again.' },
};
