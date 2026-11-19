import { supabase } from '@/lib/supabase/client';

/** A study session's live Google Doc, as the google-docs function reports it. */
export interface LiveDoc {
  url: string;
  title: string;
  autoUpdate: boolean;
  lastWrittenAt: string | null;
}

export interface LiveDocStatus {
  connected: boolean;
  needsReconnect: boolean;
  email: string | null;
  doc: LiveDoc | null;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.functions.invoke('google-docs', { body });
  let payload = data as Record<string, unknown> | null;
  if (error) {
    const context = (error as { context?: Response }).context;
    try {
      payload = context && typeof context.json === 'function' ? await context.json() : null;
    } catch {
      payload = null;
    }
  }
  if (!payload || payload.ok !== true) {
    return {
      ok: false,
      error: (payload?.error as string) || 'Google Docs could not be reached. Please try again.',
      code: payload?.code as string | undefined,
    };
  }
  return { ok: true, data: payload as unknown as T };
}

/** Where this student's Google Docs link stands, and this session's doc if any. */
export async function getLiveDocStatus(sessionId: string): Promise<Result<LiveDocStatus>> {
  return call<LiveDocStatus>({ action: 'status', sessionId });
}

/** Google's consent screen. The session to reopen afterwards is remembered here. */
export async function startGoogleDocsConnect(sessionId: string): Promise<Result<{ url: string }>> {
  try {
    window.sessionStorage.setItem(LIVE_DOC_RETURN_KEY, sessionId);
  } catch {
    // fine: the student just reopens the session themselves
  }
  return call<{ url: string }>({ action: 'start', returnTo: '/app/study-sessions' });
}

export async function createLiveDoc(sessionId: string): Promise<Result<{ doc: LiveDoc }>> {
  return call<{ doc: LiveDoc }>({ action: 'create', sessionId });
}

/** Rewrite the doc from the latest chat. Costs one AI credit. */
export async function updateLiveDoc(sessionId: string): Promise<Result<{ doc: LiveDoc }>> {
  return call<{ doc: LiveDoc }>({ action: 'update', sessionId });
}

export async function unlinkLiveDoc(sessionId: string): Promise<Result<unknown>> {
  return call<unknown>({ action: 'unlink', sessionId });
}

export async function disconnectGoogleDocs(): Promise<Result<unknown>> {
  return call<unknown>({ action: 'disconnect' });
}

/** Turns automatic updates on or off for one session's doc (the student's own row). */
export async function setLiveDocAutoUpdate(sessionId: string, autoUpdate: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('study_session_docs')
    .update({ auto_update: autoUpdate })
    .eq('session_id', sessionId);
  return !error;
}

/** sessionStorage key: the study session to reopen after Google's consent screen. */
export const LIVE_DOC_RETURN_KEY = 'tasktrack.gdocs.returnSession';
