'use client';

import { supabase } from '@/lib/supabase/client';

/**
 * ManageBac Calendar client helpers.
 *
 * The private calendar link is handed to the server exactly once, when connecting, and
 * is never read back. Everything here talks to the two server functions; the browser
 * never fetches the feed itself and never receives the saved link.
 */

export const MANAGEBAC_SOURCE = 'managebac_calendar';
export const MANAGEBAC_SOURCE_LABEL = 'ManageBac Calendar';

export interface ManageBacStatus {
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'error' | 'partial' | null;
  lastSyncError: string | null;
  lastSyncImported: number;
  createdAt: string | null;
}

export type EventDisposition = 'task' | 'event' | 'ignored';

export interface ManageBacEvent {
  id: string;
  external_uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
  due_at: string | null;
  disposition: EventDisposition;
  task_id: string | null;
}

export interface SyncChange {
  id: string;
  external_uid: string;
  task_id: string | null;
  change_kind: 'new' | 'edited' | 'submitted';
  changes: Array<{ field: string; label: string; previous: string | null; next: string | null }>;
  detected_at: string;
  is_read: boolean;
}

interface FunctionResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/** Call one of the ManageBac functions with the student's own token attached. */
async function callFunction(slug: string, body: Record<string, unknown>): Promise<FunctionResult> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { data: { session } } = await supabase.auth.getSession();
  if (!base || !session) {
    return { ok: false, error: 'Please sign in again and retry.' };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        Apikey: anon ?? '',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Could not reach TaskTrack. Check your connection and try again.' };
  }

  const parsed = await res.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
  return parsed as FunctionResult;
}

/** Whether a ManageBac calendar is connected, and how the last sync went. */
export async function getManageBacStatus(): Promise<ManageBacStatus> {
  const empty: ManageBacStatus = {
    connected: false,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncImported: 0,
    createdAt: null,
  };

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return empty;

  const { data } = await supabase
    .from('managebac_calendar_connections')
    .select('last_sync_at, last_sync_status, last_sync_error, last_sync_imported, created_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!data) return empty;

  return {
    connected: true,
    lastSyncAt: data.last_sync_at,
    lastSyncStatus: (data.last_sync_status as ManageBacStatus['lastSyncStatus']) ?? null,
    lastSyncError: data.last_sync_error,
    lastSyncImported: data.last_sync_imported ?? 0,
    createdAt: data.created_at,
  };
}

/** Send the private link to the server once. It is validated, encrypted and stored there. */
export async function connectManageBac(feedUrl: string): Promise<{ ok: boolean; error?: string }> {
  const result = await callFunction('managebac-connect', { action: 'connect', feedUrl });
  return { ok: result.ok, error: result.error };
}

/**
 * Check a link server-side without saving anything. The normalized https URL is sent;
 * the server re-validates it independently, so the browser's verdict is never trusted.
 */
export async function verifyManageBacFeed(
  feedUrl: string
): Promise<{ ok: boolean; error?: string; empty?: boolean }> {
  const result = await callFunction('managebac-connect', { action: 'verify', feedUrl });
  return { ok: result.ok, error: result.error, empty: result.empty === true };
}

/** Sync the student's own connection now. */
export async function syncManageBac(): Promise<{
  ok: boolean;
  error?: string;
  imported?: number;
  updated?: number;
  unchanged?: number;
  sparse?: boolean;
  changesDetected?: number;
  completed?: number;
}> {
  const result = await callFunction('sync-managebac-calendar', { action: 'manual' });
  return {
    ok: result.ok,
    error: result.error,
    imported: typeof result.imported === 'number' ? result.imported : undefined,
    updated: typeof result.updated === 'number' ? result.updated : undefined,
    unchanged: typeof result.unchanged === 'number' ? result.unchanged : undefined,
    sparse: result.sparse === true,
    changesDetected: typeof result.changesDetected === 'number' ? result.changesDetected : undefined,
    completed: typeof result.completed === 'number' ? result.completed : undefined,
  };
}

/** Unread sync change count, for a badge. Returns 0 when signed out. */
export async function getUnreadChangeCount(): Promise<number> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return 0;
  const { count } = await supabase
    .from('sync_change_inbox')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', auth.user.id)
    .eq('is_read', false);
  return count ?? 0;
}

/** Recent change-inbox entries, newest first. */
export async function listSyncChanges(limit = 30): Promise<SyncChange[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return [];
  const { data } = await supabase
    .from('sync_change_inbox')
    .select('id, external_uid, task_id, change_kind, changes, detected_at, is_read')
    .eq('user_id', auth.user.id)
    .order('detected_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as SyncChange[]).map((row) => ({
    ...row,
    change_kind: row.change_kind === 'edited' || row.change_kind === 'submitted' ? row.change_kind : 'new',
    changes: Array.isArray(row.changes) ? row.changes : [],
  }));
}

/** Mark one inbox entry read. */
export async function markSyncChangeRead(id: string): Promise<void> {
  await supabase.from('sync_change_inbox').update({ is_read: true }).eq('id', id);
}

/** Mark every inbox entry read for the signed-in student. */
export async function markAllSyncChangesRead(): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return;
  await supabase
    .from('sync_change_inbox')
    .update({ is_read: true })
    .eq('user_id', auth.user.id)
    .eq('is_read', false);
}

/** Stop syncing. The link is forgotten; already-imported tasks are kept. */
export async function disconnectManageBac(): Promise<{ ok: boolean; error?: string }> {
  const result = await callFunction('managebac-connect', { action: 'disconnect' });
  return { ok: result.ok, error: result.error };
}

/** Disconnect and clear the saved import bookkeeping as well. */
export async function deleteManageBacConnection(): Promise<{ ok: boolean; error?: string }> {
  const result = await callFunction('managebac-connect', { action: 'delete' });
  return { ok: result.ok, error: result.error };
}

/** Choose what an imported entry becomes. */
export async function setEventDisposition(
  uid: string,
  disposition: EventDisposition
): Promise<{ ok: boolean; error?: string }> {
  const result = await callFunction('managebac-connect', { action: 'disposition', uid, disposition });
  return { ok: result.ok, error: result.error };
}

/** Imported entries for the Calendar screen. Ignored entries are left out. */
export async function listManageBacEvents(): Promise<ManageBacEvent[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return [];

  const { data } = await supabase
    .from('managebac_calendar_events')
    .select('id, external_uid, summary, description, location, start_at, end_at, due_at, disposition, task_id')
    .eq('user_id', auth.user.id)
    .order('due_at', { ascending: true });

  return ((data ?? []) as ManageBacEvent[]).filter((e) => e.disposition !== 'ignored');
}
