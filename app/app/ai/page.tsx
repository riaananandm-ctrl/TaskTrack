'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { format, parseISO, isValid } from 'date-fns';
import {
  Bot, CheckCircle2, CircleAlert, GraduationCap, Link2, ListTodo, MessageSquarePlus, Sparkles,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import {
  listSessions, createSessionForSubject, type StudySession,
} from '@/lib/study-sessions';
import { StudySessionPanel } from '@/components/study-session-panel';
import { useAiCredits, CREDIT_COSTS } from '@/lib/ai-credits';
import { Button } from '@/components/ui/button';
import { ExamBoostCard } from '@/components/exam-boost-card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/** Title given to general (no-task) chats started from this page. */
const GENERAL_TITLE = 'TaskTrack AI';

interface Readiness {
  managebac: boolean;
  classroom: boolean;
  taskCount: number;
}

function shortDate(value: string): string {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'd MMM, HH:mm') : '';
}

export default function TaskTrackAiPage() {
  const { user } = useAuth();
  const { credits } = useAiCredits();
  const [tipOpen, setTipOpen] = useState(true);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [chats, setChats] = useState<StudySession[]>([]);
  const [active, setActive] = useState<StudySession | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [mb, gc, tasks, sessions] = await Promise.all([
      supabase.from('managebac_calendar_connections').select('user_id').eq('user_id', user.id).maybeSingle(),
      supabase.from('google_classroom_connections').select('status').maybeSingle(),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('is_archived', false),
      listSessions().catch(() => [] as StudySession[]),
    ]);
    setReady({ managebac: !!mb.data, classroom: !!gc.data, taskCount: tasks.count ?? 0 });
    setChats(sessions.filter((s) => !s.task_id && s.status !== 'archived'));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const integrated = !!ready && (ready.managebac || ready.classroom);
  const hasTasks = !!ready && ready.taskCount > 0;

  const openGeneralChat = async () => {
    setTipOpen(false);
    setError(null);
    const latest = chats.find((c) => c.status === 'active' && c.title === GENERAL_TITLE);
    if (latest) {
      setActive(latest);
      return;
    }
    setStarting(true);
    try {
      const created = await createSessionForSubject(GENERAL_TITLE);
      setChats((prev) => [created, ...prev]);
      setActive(created);
    } catch {
      setError('Could not start a chat. Check your connection and try again.');
    } finally {
      setStarting(false);
    }
  };

  const startNewChat = async () => {
    setError(null);
    setStarting(true);
    try {
      const created = await createSessionForSubject(GENERAL_TITLE);
      setChats((prev) => [created, ...prev]);
      setActive(created);
    } catch {
      setError('Could not start a chat. Check your connection and try again.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">TaskTrack AI</h1>
          <p className="text-muted-foreground mt-1">
            Ask anything about your studies. For answers that know your task, open Study Session on the task.
          </p>
        </div>
        <Button onClick={startNewChat} disabled={starting} className="gap-2">
          <MessageSquarePlus className="w-4 h-4" /> New chat
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <button
          onClick={openGeneralChat}
          disabled={starting}
          className="md:col-span-2 flex items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-md disabled:opacity-60"
        >
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Chat with TaskTrack AI</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Explanations, practice questions, flashcards, quizzes and more on any topic.
            </span>
          </span>
        </button>

        <div className="rounded-2xl border border-border bg-card p-5 text-sm shadow-sm">
          <p className="font-semibold">Your AI credits</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {credits ? `${credits.remaining} / ${credits.limit}` : '…'}
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <li>Chat or explain: {CREDIT_COSTS.chat}</li>
            <li>Flashcards: {CREDIT_COSTS.flashcards}</li>
            <li>Quiz, study plan or slides: {CREDIT_COSTS.quiz}</li>
          </ul>
        </div>
      </div>

      <ExamBoostCard />

      {ready && (!integrated || !hasTasks) && (
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="font-semibold text-amber-900 dark:text-amber-200">Get answers that know your work</p>
          <p className="mt-1 text-amber-900/80 dark:text-amber-100/80">
            {!integrated && !hasTasks
              ? 'Connect ManageBac or Google Classroom so your tasks come in on their own.'
              : !integrated
                ? 'Connect ManageBac or Google Classroom so new tasks come in on their own.'
                : 'Add a task, then open Study Session on it.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!integrated && (
              <Button asChild size="sm" className="gap-1.5">
                <Link href="/app/settings?tab=integrations"><Link2 className="h-3.5 w-3.5" /> Connect</Link>
              </Button>
            )}
            {!hasTasks && (
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link href="/app/tasks"><ListTodo className="h-3.5 w-3.5" /> Add a task</Link>
              </Button>
            )}
          </div>
        </div>
      )}

      {chats.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Recent chats</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {chats.slice(0, 15).map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setActive(c)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent"
                >
                  <Sparkles className="h-4 w-4 flex-shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {c.message_count} {c.message_count === 1 ? 'message' : 'messages'} · {shortDate(c.updated_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={tipOpen} onOpenChange={setTipOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" /> Tip: use it on your task
            </DialogTitle>
            <DialogDescription>
              Click <span className="font-semibold text-foreground">Study Session</span> on top of any task and
              TaskTrack AI opens with full knowledge of your curriculum and that task: subject, details, due date
              and any files you attach.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              {ready === null ? (
                <span className="mt-0.5 h-4 w-4 flex-shrink-0 animate-pulse rounded-full bg-muted" />
              ) : integrated ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              ) : (
                <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              )}
              <span>
                {ready === null
                  ? 'Checking your connections…'
                  : integrated
                    ? `Connected to ${[ready.managebac && 'ManageBac', ready.classroom && 'Google Classroom'].filter(Boolean).join(' and ')}.`
                    : 'ManageBac or Google Classroom is not connected yet. Connect one so your tasks come in on their own.'}
              </span>
            </li>
            <li className="flex items-start gap-2">
              {ready === null ? (
                <span className="mt-0.5 h-4 w-4 flex-shrink-0 animate-pulse rounded-full bg-muted" />
              ) : hasTasks ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              ) : (
                <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              )}
              <span>
                {ready === null
                  ? 'Checking your tasks…'
                  : hasTasks
                    ? `You have ${ready.taskCount} ${ready.taskCount === 1 ? 'task' : 'tasks'} ready for a Study Session.`
                    : 'You have no tasks yet. Add one to use Study Session on it.'}
              </span>
            </li>
          </ul>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            {ready && !integrated && (
              <Button asChild variant="outline">
                <Link href="/app/settings?tab=integrations">Connect ManageBac or Classroom</Link>
              </Button>
            )}
            {ready && integrated && hasTasks && (
              <Button asChild variant="outline">
                <Link href="/app/tasks">Go to my tasks</Link>
              </Button>
            )}
            {ready && integrated && !hasTasks && (
              <Button asChild variant="outline">
                <Link href="/app/tasks">Add a task</Link>
              </Button>
            )}
            <Button onClick={openGeneralChat} disabled={starting}>
              Use TaskTrack AI now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {active && (
        <StudySessionPanel
          session={active}
          open={!!active}
          onClose={() => setActive(null)}
          onActivity={load}
          onStatusChange={(updated) => {
            setChats((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            setActive(updated);
          }}
          onNewSession={startNewChat}
        />
      )}
    </div>
  );
}
