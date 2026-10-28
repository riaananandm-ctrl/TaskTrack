'use client';

import { supabase } from '@/lib/supabase/client';

/**
 * Scheduled study sessions are stored in the existing `reminders` table rather than a
 * second scheduling system. They are ordinary reminders distinguished by their type,
 * so they appear in the Notifications page and survive refreshes and logins.
 *
 * Alongside the shared reminder columns each scheduled session records its own
 * duration, the Study Session conversation it came from, an explicit status, and a
 * stable dedupe key used to stop a generated plan from being saved twice.
 *   - is_enabled  → true while the session is still upcoming
 *   - status      → 'scheduled' | 'completed' | 'cancelled'
 *   - is_read     → whether the student has seen it
 */
const STUDY_SESSION_TYPE = 'study_session';

/** The default time of day for a scheduled study session. */
const DEFAULT_START_TIME = '17:00';

/** Postgres unique-violation code, raised by the dedupe index. */
const UNIQUE_VIOLATION = '23505';

export type StudySessionStatus = 'scheduled' | 'completed' | 'cancelled';

export interface PlanSessionInput {
  date: string;
  focus: string;
  topics: string[];
  minutes: number | null;
}

export interface ScheduledStudySession {
  id: string;
  task_id: string | null;
  session_id: string | null;
  title: string;
  message: string | null;
  scheduled_for: string;
  duration_minutes: number | null;
  status: StudySessionStatus;
  is_enabled: boolean;
  is_read: boolean;
  created_at: string | null;
  updated_at: string | null;
}

interface ReminderRow {
  id: string;
  task_id: string | null;
  session_id: string | null;
  title: string;
  message: string | null;
  scheduled_for: string;
  duration_minutes: number | null;
  status: string | null;
  is_enabled: boolean;
  is_read: boolean;
  created_at: string | null;
  updated_at: string | null;
}

const REMINDER_COLUMNS =
  'id, task_id, session_id, title, message, scheduled_for, duration_minutes, status, is_enabled, is_read, created_at, updated_at';

/** A row's status, falling back to its enabled flag for rows saved before status existed. */
function readStatus(row: ReminderRow): StudySessionStatus {
  if (row.status === 'completed' || row.status === 'cancelled') return row.status;
  if (!row.is_enabled) return 'completed';
  return 'scheduled';
}

function toSession(row: ReminderRow): ScheduledStudySession {
  return {
    id: row.id,
    task_id: row.task_id,
    session_id: row.session_id,
    title: row.title,
    message: row.message,
    scheduled_for: row.scheduled_for,
    duration_minutes: row.duration_minutes,
    status: readStatus(row),
    is_enabled: row.is_enabled,
    is_read: row.is_read,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Combine a plain date with a time into the instant a session is scheduled for. */
function toInstant(date: string, time = DEFAULT_START_TIME): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  const [hours, minutes] = time.split(':').map((n) => Number(n));
  const at = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number.isFinite(hours) ? hours : 17,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString();
}

/**
 * Stable key that identifies one scheduled study session. It is built from the task,
 * the date and the purpose, so regenerating the same plan — in this conversation or a
 * later one — never creates a second reminder for the same sitting. It deliberately
 * excludes the conversation id: a plan regenerated in a new session is still the same
 * sitting, and should update rather than duplicate.
 */
function dedupeKey(taskId: string, instant: string, purpose: string | null): string {
  const day = instant.slice(0, 10);
  const goal = (purpose ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${taskId}|${day}|${goal}`.slice(0, 400);
}

/** Every study session scheduled for a task, soonest first. */
export async function listStudySessionsForTask(taskId: string): Promise<ScheduledStudySession[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select(REMINDER_COLUMNS)
    .eq('task_id', taskId)
    .eq('reminder_type', STUDY_SESSION_TYPE)
    .order('scheduled_for', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toSession(r as ReminderRow));
}

/** The next still-scheduled session for a task, or null when none is upcoming. */
export async function getNextStudySession(
  taskId: string
): Promise<ScheduledStudySession | null> {
  const { data, error } = await supabase
    .from('reminders')
    .select(REMINDER_COLUMNS)
    .eq('task_id', taskId)
    .eq('reminder_type', STUDY_SESSION_TYPE)
    .eq('is_enabled', true)
    .gte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toSession(data as ReminderRow) : null;
}

/** All upcoming study sessions across the student's tasks, for the notifications list. */
export async function listUpcomingStudySessions(): Promise<ScheduledStudySession[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select(REMINDER_COLUMNS)
    .eq('reminder_type', STUDY_SESSION_TYPE)
    .eq('is_enabled', true)
    .gte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toSession(r as ReminderRow));
}

/** Schedule one study session for a task at a specific moment. */
export async function scheduleStudySession(params: {
  taskId: string;
  taskTitle: string;
  when: string;
  minutes?: number | null;
  purpose?: string | null;
  sessionId?: string | null;
}): Promise<ScheduledStudySession | null> {
  const row = {
    task_id: params.taskId,
    session_id: params.sessionId ?? null,
    title: `${params.taskTitle} study session`,
    message: params.purpose ?? null,
    reminder_type: STUDY_SESSION_TYPE,
    scheduled_for: params.when,
    duration_minutes: params.minutes ?? null,
    status: 'scheduled' as const,
    repeat_rule: 'none',
    is_enabled: true,
    is_read: false,
    dedupe_key: dedupeKey(params.taskId, params.when, params.purpose ?? null),
  };

  const { data, error } = await supabase
    .from('reminders')
    .insert(row)
    .select(REMINDER_COLUMNS)
    .maybeSingle();

  // A collision means this sitting is already scheduled, so it is left as it is.
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw error;
  }
  return data ? toSession(data as ReminderRow) : null;
}

/**
 * Persist the future sessions of a generated study plan. Sessions already scheduled for
 * the same task and date are left untouched, so refreshing or regenerating a plan never
 * piles up duplicates. Past dates are never saved.
 * Returns how many new sessions were stored.
 */
export async function scheduleFromPlan(
  params: {
    taskId: string;
    taskTitle: string;
    sessionId?: string | null;
    fallbackMinutes?: number | null;
  },
  planSessions: PlanSessionInput[]
): Promise<number> {
  const existing = await listStudySessionsForTask(params.taskId);
  const taken = new Set(existing.map((s) => dedupeKey(s.task_id ?? params.taskId, s.scheduled_for, s.message)));

  const now = Date.now();
  const seen = new Set<string>();
  let saved = 0;

  for (const session of planSessions) {
    const instant = toInstant(session.date);
    if (!instant) continue;
    // Only genuine future sessions are scheduled; a past date is never saved.
    if (new Date(instant).getTime() <= now) continue;

    const purpose = session.focus?.trim() || null;
    const key = dedupeKey(params.taskId, instant, purpose);
    if (taken.has(key) || seen.has(key)) continue;
    seen.add(key);

    // One row per sitting, so a single conflict cannot drop the rest of the plan.
    const { error } = await supabase.from('reminders').insert({
      task_id: params.taskId,
      session_id: params.sessionId ?? null,
      title: `${params.taskTitle} study session`,
      message: purpose,
      reminder_type: STUDY_SESSION_TYPE,
      scheduled_for: instant,
      duration_minutes: session.minutes ?? params.fallbackMinutes ?? null,
      status: 'scheduled',
      repeat_rule: 'none',
      is_enabled: true,
      is_read: false,
      dedupe_key: key,
    });

    if (error) {
      if (error.code === UNIQUE_VIOLATION) continue;
      throw error;
    }
    saved += 1;
  }

  return saved;
}

/**
 * When a task is completed, its remaining scheduled study sessions are stood down so
 * they leave the upcoming list. They are marked completed rather than deleted, so the
 * study history and the conversation are both preserved.
 */
export async function completeStudySessionsForTask(taskId: string): Promise<void> {
  await supabase
    .from('reminders')
    .update({
      is_enabled: false,
      is_read: true,
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('task_id', taskId)
    .eq('reminder_type', STUDY_SESSION_TYPE)
    .eq('is_enabled', true);
}
