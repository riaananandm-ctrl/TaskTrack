'use client';

import { supabase } from '@/lib/supabase/client';
import type { StudyMode } from '@/lib/study-modes';

export type SessionStatus = 'active' | 'completed' | 'archived';

export interface SessionTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
  category: string;
  estimated_minutes: number | null;
  status: string;
  subject_id: string | null;
  /** Where the task came from, e.g. 'managebac_calendar'. */
  external_source?: string | null;
  subject?: { name: string; colour: string } | null;
}

export interface StudySession {
  id: string;
  user_id: string;
  task_id: string | null;
  title: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  task?: SessionTask | null;
  message_count: number;
}

export interface StudySessionMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: StudyMode | null;
  structured_data: unknown;
  created_at: string;
}

const SESSION_SELECT = 'id, user_id, task_id, title, status, created_at, updated_at, task:tasks(id, title, description, due_date, priority, category, estimated_minutes, status, subject_id, external_source, subject:subjects(name, colour)), study_session_messages(count)';

interface RawSession {
  id: string;
  user_id: string;
  task_id: string | null;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  task?: SessionTask | null;
  study_session_messages?: Array<{ count: number }> | null;
}

function toSession(raw: RawSession): StudySession {
  const status: SessionStatus =
    raw.status === 'completed' || raw.status === 'archived' ? raw.status : 'active';
  return {
    id: raw.id,
    user_id: raw.user_id,
    task_id: raw.task_id,
    title: raw.title,
    status,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    task: raw.task ?? null,
    message_count: raw.study_session_messages?.[0]?.count ?? 0,
  };
}

export async function listSessions(): Promise<StudySession[]> {
  const { data, error } = await supabase
    .from('study_sessions')
    .select(SESSION_SELECT)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as RawSession[]).map(toSession);
}

export async function getSession(sessionId: string): Promise<StudySession | null> {
  const { data, error } = await supabase
    .from('study_sessions')
    .select(SESSION_SELECT)
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? toSession(data as unknown as RawSession) : null;
}

export async function createSession(task: { id: string; title: string }): Promise<StudySession> {
  const { data, error } = await supabase
    .from('study_sessions')
    .insert({ task_id: task.id, title: task.title, status: 'active' })
    .select(SESSION_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The study session could not be created.');
  return toSession(data as unknown as RawSession);
}

export async function createSessionForSubject(title: string): Promise<StudySession> {
  const { data, error } = await supabase
    .from('study_sessions')
    .insert({ task_id: null, title, status: 'active' })
    .select(SESSION_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The study session could not be created.');
  return toSession(data as unknown as RawSession);
}

/**
 * The most recent still-active session for a task. Used by the task-card button so
 * repeated clicks resume the same conversation instead of piling up empty sessions.
 */
export async function findActiveSessionForTask(taskId: string): Promise<StudySession | null> {
  const { data, error } = await supabase
    .from('study_sessions')
    .select(SESSION_SELECT)
    .eq('task_id', taskId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toSession(data as unknown as RawSession) : null;
}

export async function getSessionMessages(sessionId: string): Promise<StudySessionMessage[]> {
  const { data, error } = await supabase
    .from('study_session_messages')
    .select('id, session_id, user_id, role, content, mode, structured_data, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({
    ...m,
    role: m.role === 'assistant' ? 'assistant' : 'user',
  })) as StudySessionMessage[];
}

export async function addMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  mode?: StudyMode | null;
  structuredData?: unknown;
}): Promise<StudySessionMessage> {
  const { data, error } = await supabase
    .from('study_session_messages')
    .insert({
      session_id: params.sessionId,
      role: params.role,
      content: params.content,
      mode: params.mode ?? null,
      structured_data: params.structuredData ?? null,
    })
    .select('id, session_id, user_id, role, content, mode, structured_data, created_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The message could not be saved.');
  return data as StudySessionMessage;
}

/** Bump updated_at so the session sorts to the top of "Recent". */
export async function touchSession(sessionId: string): Promise<void> {
  await supabase
    .from('study_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('study_sessions')
    .update({ title })
    .eq('id', sessionId);
  if (error) throw error;
}

export async function setSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
  const { error } = await supabase
    .from('study_sessions')
    .update({ status })
    .eq('id', sessionId);
  if (error) throw error;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('study_sessions').delete().eq('id', sessionId);
  if (error) throw error;
}
