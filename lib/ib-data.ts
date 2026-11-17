'use client';

import { supabase } from '@/lib/supabase/client';
import type { GradeEntry, Programme, Criterion } from '@/lib/ib-grades';
import { buildRevisionPlan, type PlanExam } from '@/lib/revision-plan';
import { buildMilestones, PROJECT_LABEL, type ProjectKind } from '@/lib/milestones';

/** Data access for IB Hub, streaks, buddies and the parent summary. Row-level security keeps it all per-student. */

/** Today's date (YYYY-MM-DD) on the student's device. */
export function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function friendly(error: { message?: string } | null, fallback: string): Error {
  const msg = error?.message ?? '';
  if (msg.includes('too_many_rows')) return new Error('You’ve reached the limit for this list. Delete some old entries first.');
  if (msg.includes('parent_consent_required')) return new Error('Group Study features need a parent or guardian’s OK first.');
  if (msg.includes('consent_required')) return new Error('Please accept the terms first.');
  if (msg.includes('not_in_your_groups')) return new Error('You can only buddy up with people in your study groups.');
  if (msg.includes('too_many_buddies')) return new Error('You already have the maximum of 10 buddies.');
  return new Error(fallback);
}

// ---------------------------------------------------------------- grades

export async function listGrades(): Promise<GradeEntry[]> {
  const { data, error } = await supabase
    .from('ib_grades')
    .select('id, subject_name, programme, level, assessment, criterion, mark, assessed_on')
    .order('assessed_on', { ascending: false })
    .limit(1000);
  if (error) throw friendly(error, 'Your grades could not be loaded.');
  return (data ?? []) as GradeEntry[];
}

export async function addGrades(rows: {
  subject_name: string;
  programme: Programme;
  level: 'SL' | 'HL' | null;
  assessment: string | null;
  assessed_on: string;
  marks: { criterion: Criterion | null; mark: number }[];
}): Promise<void> {
  const insert = rows.marks.map((m) => ({
    subject_name: rows.subject_name.trim().slice(0, 60),
    programme: rows.programme,
    level: rows.programme === 'DP' ? rows.level : null,
    assessment: rows.assessment?.trim().slice(0, 120) || null,
    assessed_on: rows.assessed_on,
    criterion: m.criterion,
    mark: m.mark,
  }));
  const { error } = await supabase.from('ib_grades').insert(insert);
  if (error) throw friendly(error, 'Those marks could not be saved.');
}

export async function deleteGrade(id: string): Promise<void> {
  const { error } = await supabase.from('ib_grades').delete().eq('id', id);
  if (error) throw friendly(error, 'That mark could not be deleted.');
}

// ---------------------------------------------------------------- exams + revision

export interface Exam extends PlanExam {
  kind: 'mock' | 'final' | 'test';
}

export interface RevisionSession {
  id: string;
  exam_id: string;
  session_date: string;
  focus: string;
  minutes: number;
  done: boolean;
}

export async function listExams(): Promise<Exam[]> {
  const { data, error } = await supabase
    .from('ib_exams')
    .select('id, subject_name, paper, kind, exam_date')
    .order('exam_date');
  if (error) throw friendly(error, 'Your exams could not be loaded.');
  return (data ?? []) as Exam[];
}

export async function listRevisionSessions(): Promise<RevisionSession[]> {
  const { data, error } = await supabase
    .from('ib_revision_sessions')
    .select('id, exam_id, session_date, focus, minutes, done')
    .gte('session_date', localToday())
    .order('session_date')
    .limit(500);
  if (error) throw friendly(error, 'Your revision plan could not be loaded.');
  return (data ?? []) as RevisionSession[];
}

export async function addExams(exams: Omit<Exam, 'id'>[]): Promise<void> {
  const { error } = await supabase.from('ib_exams').insert(
    exams.map((e) => ({ ...e, subject_name: e.subject_name.trim().slice(0, 60), paper: e.paper?.trim().slice(0, 60) || null })),
  );
  if (error) throw friendly(error, 'That exam could not be saved.');
  await rebuildRevisionPlan();
}

export async function deleteExam(id: string): Promise<void> {
  const { error } = await supabase.from('ib_exams').delete().eq('id', id);
  if (error) throw friendly(error, 'That exam could not be deleted.');
  await rebuildRevisionPlan();
}

/**
 * Re-plans every upcoming, not-yet-done session from today. Finished sessions
 * stay, and count towards each day's limit.
 */
export async function rebuildRevisionPlan(maxPerDay = 3): Promise<void> {
  const today = localToday();
  const [exams, sessions] = await Promise.all([listExams(), listRevisionSessions()]);
  const { error: delError } = await supabase
    .from('ib_revision_sessions')
    .delete()
    .gte('session_date', today)
    .eq('done', false);
  if (delError) throw friendly(delError, 'Your revision plan could not be updated.');

  const busy: Record<string, number> = {};
  for (const s of sessions) if (s.done) busy[s.session_date] = (busy[s.session_date] ?? 0) + 1;
  const plan = buildRevisionPlan(exams, today, { maxPerDay, busy });
  if (!plan.length) return;
  const { error } = await supabase.from('ib_revision_sessions').insert(plan);
  if (error) throw friendly(error, 'Your revision plan could not be saved.');
}

export async function setSessionDone(id: string, done: boolean): Promise<void> {
  const { error } = await supabase.from('ib_revision_sessions').update({ done }).eq('id', id);
  if (error) throw friendly(error, 'That session could not be updated.');
}

// ---------------------------------------------------------------- IA / EE projects

export interface IbProject {
  id: string;
  kind: ProjectKind;
  title: string;
  subject_name: string | null;
  start_date: string;
  due_date: string;
}

export interface MilestoneTask {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  external_uid: string | null;
}

export async function listProjects(): Promise<{ projects: IbProject[]; tasks: MilestoneTask[] }> {
  const [p, t] = await Promise.all([
    supabase.from('ib_projects').select('id, kind, title, subject_name, start_date, due_date').order('due_date'),
    supabase
      .from('tasks')
      .select('id, title, due_date, status, external_uid')
      .eq('external_source', 'ib_project')
      .eq('is_archived', false)
      .order('due_date'),
  ]);
  if (p.error || t.error) throw friendly(p.error ?? t.error, 'Your projects could not be loaded.');
  return { projects: (p.data ?? []) as IbProject[], tasks: (t.data ?? []) as MilestoneTask[] };
}

/** Creates the project and one task per checkpoint, so they show in My Tasks, the calendar and reminders. */
export async function createProject(input: Omit<IbProject, 'id'> & { subject_id?: string | null }): Promise<void> {
  const { subject_id, ...project } = input;
  const { data, error } = await supabase
    .from('ib_projects')
    .insert({ ...project, title: project.title.trim().slice(0, 120), subject_name: project.subject_name?.trim().slice(0, 60) || null })
    .select('id')
    .single();
  if (error || !data) throw friendly(error, 'That project could not be saved.');

  const label = PROJECT_LABEL[project.kind];
  const milestones = buildMilestones(project.kind, project.start_date, project.due_date);
  const tasks = milestones.map((m) => ({
    title: `${label}: ${m.title}`.slice(0, 200),
    description: `Checkpoint ${m.n} for “${project.title.trim()}”. Created by IB Hub.`,
    due_date: m.due_date,
    category: 'project',
    priority: m.n === milestones.length ? 'high' : 'medium',
    subject_id: subject_id ?? null,
    external_source: 'ib_project',
    external_uid: `${data.id}:${m.n}`,
  }));
  const { error: taskError } = await supabase.from('tasks').insert(tasks);
  if (taskError) {
    await supabase.from('ib_projects').delete().eq('id', data.id);
    throw friendly(taskError, 'The checkpoints could not be created.');
  }
}

/** Deletes the project and its unfinished checkpoint tasks (finished ones stay in your history). */
export async function deleteProject(id: string): Promise<void> {
  const { error: tErr } = await supabase
    .from('tasks')
    .delete()
    .eq('external_source', 'ib_project')
    .like('external_uid', `${id}:%`)
    .neq('status', 'completed');
  if (tErr) throw friendly(tErr, 'That project could not be deleted.');
  const { error } = await supabase.from('ib_projects').delete().eq('id', id);
  if (error) throw friendly(error, 'That project could not be deleted.');
}

export async function setMilestoneDone(taskId: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: done ? 'completed' : 'not_started', completed_at: done ? new Date().toISOString() : null })
    .eq('id', taskId);
  if (error) throw friendly(error, 'That checkpoint could not be updated.');
}

// ---------------------------------------------------------------- streaks + buddies

export interface MyStreak {
  current_streak: number;
  longest_streak: number;
  studied_today: boolean;
}

export async function getMyStreak(): Promise<MyStreak> {
  const { data, error } = await supabase.rpc('get_my_streak');
  if (error) throw friendly(error, 'Your streak could not be loaded.');
  const row = (Array.isArray(data) ? data[0] : data) as MyStreak | undefined;
  return row ?? { current_streak: 0, longest_streak: 0, studied_today: false };
}

export interface Buddy {
  id: string;
  first_name: string;
  status: 'pending' | 'active';
  incoming: boolean;
  me_today: boolean;
  buddy_today: boolean;
  shared_streak: number;
}

export async function listBuddies(): Promise<Buddy[]> {
  const { data, error } = await supabase.rpc('my_streak_buddies');
  if (error) throw friendly(error, 'Your buddies could not be loaded.');
  return (data ?? []) as Buddy[];
}

export async function listBuddyCandidates(): Promise<{ user_id: string; first_name: string }[]> {
  const { data, error } = await supabase.rpc('buddy_candidates');
  if (error) throw friendly(error, 'Your study group members could not be loaded.');
  return (data ?? []) as { user_id: string; first_name: string }[];
}

export async function requestBuddy(userId: string): Promise<void> {
  const { error } = await supabase.rpc('request_streak_buddy', { p_user: userId });
  if (error) throw friendly(error, 'That request could not be sent.');
}

export async function respondBuddy(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_streak_buddy', { p_id: id, p_accept: accept });
  if (error) throw friendly(error, 'That request could not be answered.');
}

export async function removeBuddy(id: string): Promise<void> {
  const { error } = await supabase.rpc('remove_streak_buddy', { p_id: id });
  if (error) throw friendly(error, 'That buddy could not be removed.');
}

// ---------------------------------------------------------------- parent summary

export async function getParentSummaryStatus(): Promise<{ on: boolean; since: string | null }> {
  const { data, error } = await supabase.from('parent_summary_links').select('created_at').maybeSingle();
  if (error) throw friendly(error, 'The parent summary setting could not be loaded.');
  return { on: !!data, since: (data as { created_at?: string } | null)?.created_at ?? null };
}

/** Makes a new link (any old link stops working) and returns the full URL. */
export async function createParentSummaryLink(): Promise<string> {
  const { data, error } = await supabase.rpc('create_parent_summary_link');
  if (error || typeof data !== 'string') throw friendly(error, 'The link could not be created.');
  return `${window.location.origin}/parent-summary?t=${data}`;
}

export async function revokeParentSummaryLink(): Promise<void> {
  const { error } = await supabase.rpc('revoke_parent_summary_link');
  if (error) throw friendly(error, 'The link could not be turned off.');
}
