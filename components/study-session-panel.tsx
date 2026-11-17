'use client';

import Link from 'next/link';
import { isSubmissionTask } from '@/lib/ai-tools';
import { GraderIcon } from '@/components/brand-icons';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Send, Loader2, AlertCircle, Lock, CheckCircle2, RotateCcw,
  ChevronDown, CalendarDays, Clock, CalendarPlus, Paperclip, FileText,
  ShieldAlert, Sparkles, Crown, BookOpen, ListChecks, Presentation,
  Lightbulb, CalendarRange, MessageSquare, PenLine,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Logo } from '@/components/logo';
import { QuizView, FlashcardsView, PlanView, SlidesView } from '@/components/study-views';
import { CountdownTimer } from '@/components/countdown-timer';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useAiCredits, announceCreditsChanged, refillDate } from '@/lib/ai-credits';
import { getProfileEntitlements, resolvePlan } from '@/lib/entitlements';
import {
  uploadDocument, listDocuments, getUploadUsage, deleteDocument,
  type DocumentRow,
} from '@/lib/documents';
import {
  AI_OPTIONS, getAiOption, UPLOAD_LIMITS, ACCEPTED_FILE_TYPES,
  formatBytes, validateFile,
  type AiOptionId,
} from '@/lib/ai-options';
import {
  MODE_OPTIONS, MODE_SELECT_OPTIONS,
  toTaskContext,
  parseStructuredResult,
  displayContent,
  modeLabel,
  type StudyMode,
  type StudyTask,
  type QuizData,
  type FlashcardsData,
  type StudyPlanData,
  type PlanSession,
  type SlidesData,
} from '@/lib/study-modes';
import {
  addMessage,
  getSessionMessages,
  setSessionStatus,
  touchSession,
  type StudySession,
  type SessionTask as StudySessionTask,
  type StudySessionMessage,
} from '@/lib/study-sessions';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PRIORITY_LABELS, CATEGORY_LABELS, type Priority, type TaskCategory } from '@/lib/types';
import { cn } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';
import {
  getNextStudySession,
  listStudySessionsForTask,
  completeStudySessionsForTask,
  scheduleFromPlan,
  scheduleStudySession,
  type ScheduledStudySession,
} from '@/lib/study-schedule';
import { saveQuizAttempt, type QuizResult } from '@/lib/quiz-attempts';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: StudyMode | null;
  structured: unknown;
}

/** A document attached to this study session for context. */
interface AttachmentChip {
  id: string;
  name: string;
  size: number;
  status: 'ready' | 'failed';
  /** Server document id for ready files, so chat can reference them. */
  documentId?: string;
}

interface StudySessionPanelProps {
  session: StudySession;
  open: boolean;
  onClose: () => void;
  /** Called when a message is saved so the parent list can refresh. */
  onActivity?: () => void;
  /** Called when a brand-new empty session should be started for this session's task. */
  onNewSession?: () => void;
  onStatusChange?: (session: StudySession) => void;
}

const NETWORK_ERROR =
  'Could not reach TaskTrack AI. Check your connection and try again.';

/** Compact, restrained icons for the study-tool grid. */
const TOOL_ICONS: Record<StudyMode, ReactNode> = {
  chat: <MessageSquare className="w-4 h-4" />,
  explain: <Lightbulb className="w-4 h-4" />,
  flashcards: <BookOpen className="w-4 h-4" />,
  quiz: <ListChecks className="w-4 h-4" />,
  plan: <CalendarRange className="w-4 h-4" />,
  examples: <MessageSquare className="w-4 h-4" />,
  practice: <PenLine className="w-4 h-4" />,
  slides: <Presentation className="w-4 h-4" />,
};

function toDisplay(row: StudySessionMessage): DisplayMessage {
  const mode = (row.mode as StudyMode | null) ?? null;
  const structured = mode && row.structured_data
    ? parseStructuredResult(mode, row.structured_data)
    : null;
  return {
    id: row.id,
    role: row.role,
    content: displayContent(mode, row.content, Boolean(structured)),
    mode: structured ? mode : null,
    structured: structured ?? undefined,
  };
}

function summary(text: string | null | undefined, max = 120): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

export function StudySessionPanel({
  session,
  open,
  onClose,
  onActivity,
  onNewSession,
  onStatusChange,
}: StudySessionPanelProps) {
  const { profile } = useAuth();
  const entitlements = getProfileEntitlements(profile);
  const maxChars = entitlements.maxMessageChars;

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { credits } = useAiCredits();
  // Locked only when nothing is left; with a few credits left, cheaper modes still work.
  const limitReached = credits?.remaining === 0;
  const [selectedAi, setSelectedAi] = useState<AiOptionId>('tasktrack-ai');
  // The mode applied to the NEXT message. Changing it never sends a message.
  const [selectedMode, setSelectedMode] = useState<StudyMode>('chat');
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [aiNotice, setAiNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const isPro = resolvePlan(profile) === 'pro';
  const [status, setStatus] = useState(session.status);
  const [nextSession, setNextSession] = useState<ScheduledStudySession | null>(null);
  const [scheduling, setScheduling] = useState(false);
  // On small screens the assistant is a collapsible section opened by its tab.
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Portals need a browser-side target; rendering them on the server would throw.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);

  // Lock background scrolling while the workspace covers the viewport.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const task = session.task;
  // Everything the app already knows about the task goes with the request, so the
  // student never has to repeat it.
  const taskContext: StudyTask = {
    taskId: task?.id ?? null,
    title: task?.title || session.title,
    subject: task?.subject?.name || null,
    description: task?.description ?? null,
    category: task?.category ?? null,
    dueDate: task?.due_date ?? null,
    estimatedMinutes: task?.estimated_minutes ?? null,
    priority: task?.priority ?? null,
  };

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Load this session's own saved messages. Keyed on session id so switching
  // sessions can never show another session's history.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingHistory(true);
    setError(null);
    setStatus(session.status);

    getSessionMessages(session.id)
      .then((rows) => {
        if (!cancelled) setMessages(rows.map(toDisplay));
      })
      .catch(() => {
        if (!cancelled) setError('Your saved messages could not be loaded. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, session.id, session.status]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, loadingHistory, scrollToBottom]);

  // The next scheduled study session for the linked task, shown in the sidebar.
  useEffect(() => {
    if (!open || !task?.id) {
      setNextSession(null);
      return;
    }
    let cancelled = false;
    getNextStudySession(task.id)
      .then((row) => {
        if (!cancelled) setNextSession(row);
      })
      .catch(() => {
        if (!cancelled) setNextSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, task?.id]);

  /**
   * Save the future sessions of a freshly generated plan, so they persist and show up
   * in this sidebar and in Notifications. Failure never hides the plan itself.
   */
  const persistPlan = useCallback(
    async (data: StudyPlanData) => {
      if (!task?.id) return;
      try {
        await scheduleFromPlan(
          {
            taskId: task.id,
            taskTitle: task.title,
            sessionId: session.id,
            fallbackMinutes: task.estimated_minutes,
          },
          data.sessions
        );
        // Reload regardless of how many were new, so a plan that was already saved
        // still shows its next upcoming session in the sidebar.
        setNextSession(await getNextStudySession(task.id));
      } catch {
        // The plan is already visible; scheduling is best-effort here.
      }
    },
    [task?.id, task?.title, task?.estimated_minutes, session.id]
  );

  const scheduleNext = useCallback(async () => {
    if (!task?.id || scheduling) return;
    setScheduling(true);
    setError(null);
    try {
      const [first] = await listStudySessionsForTask(task.id);
      const base = first ? new Date(first.scheduled_for) : new Date();
      const when = new Date(base);
      // Space sessions a day apart, always in the future.
      when.setDate(when.getDate() + (first ? 1 : 1));
      when.setHours(17, 0, 0, 0);
      if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);

      await scheduleStudySession({
        taskId: task.id,
        taskTitle: task.title,
        when: when.toISOString(),
        minutes: task.estimated_minutes,
        purpose: `Study ${task.title}`,
        sessionId: session.id,
      });
      setNextSession(await getNextStudySession(task.id));
    } catch {
      setError('The study session could not be scheduled. Please try again.');
    } finally {
      setScheduling(false);
    }
  }, [task?.id, task?.title, task?.estimated_minutes, session.id, scheduling]);

  const practiseSession = (plan: PlanSession) => {
    if (loading || limitReached) return;
    const topics = plan.topics.length ? ` (${plan.topics.join(', ')})` : '';
    setSelectedMode('practice');
    setMobileChatOpen(true);
    sendMessage(`Give me an exam-style practice question on: ${plan.focus}${topics}.${plan.practice ? ` Plan task: ${plan.practice}` : ''}`, 'practice');
  };

  const sendMessage = async (text: string, mode: StudyMode) => {
    if (!text.trim() || loading || limitReached) return;

    if (text.length > maxChars) {
      setError(`Your message is too long. Please keep it under ${maxChars.toLocaleString()} characters.`);
      return;
    }

    setInput('');
    setError(null);
    setLoading(true);

    // Show the user's message immediately; the server assigns the real row id.
    const optimistic: DisplayMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      mode: null,
      structured: undefined,
    };
    const history = [...messages, optimistic];
    setMessages(history);

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) {
        setError('Please sign in to use TaskTrack AI.');
        setMessages(messages);
        setLoading(false);
        return;
      }

      // Persist the student's message and refresh the session ordering.
      let savedUser: StudySessionMessage;
      try {
        savedUser = await addMessage({
          sessionId: session.id,
          role: 'user',
          content: text,
          mode,
        });
        await touchSession(session.id);
      } catch {
        setError('Your message could not be saved. Please try again.');
        setMessages(messages);
        setLoading(false);
        return;
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? toDisplay(savedUser) : m))
      );

      // The assistant runs in the deployed Supabase function `study-session-chat`.
      // The authenticated client carries the current user's session token into the
      // Authorization header on its own, so no key or token is ever put in the
      // request by hand. This replaces the app's own server route, which the preview
      // host did not execute.
      type AssistantData = {
        ok?: boolean;
        mode?: string;
        text?: string;
        structured?: unknown;
        messageId?: string | null;
        usage?: { used: number; limit: number; remaining: number } | null;
        error?: { code?: string; message?: string } | string;
      };

      let data: AssistantData | null = null;

      const { data: result, error: invokeError } = await supabase.functions.invoke(
        'study-session-chat',
        {
          body: {
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            task: taskContext,
            mode,
            aiOption: selectedAi,
            attachmentIds: attachments
              .filter((a) => a.status === 'ready' && a.documentId)
              .map((a) => a.documentId as string),
          },
        }
      );

      if (invokeError) {
        // A non-success status arrives here. The function's own JSON error body is
        // read back so the student sees the safe message the function chose; the raw
        // status is used only when no readable body came back.
        const context = (invokeError as { context?: unknown }).context;
        const upstream =
          context && typeof (context as Response).json === 'function'
            ? (context as Response)
            : null;
        const status = upstream?.status ?? 0;
        if (upstream) {
          try {
            data = (await upstream.json()) as AssistantData;
          } catch {
            data = null;
          }
        }
        const bodyError = data && typeof data.error === 'object' ? data.error : null;
        setError(
          bodyError?.message ||
            (status
              ? `TaskTrack AI is temporarily unavailable (status ${status}). Please try again.`
              : NETWORK_ERROR)
        );
        if (bodyError?.code === 'QUOTA_EXCEEDED') announceCreditsChanged();
        setLoading(false);
        return;
      }

      data = (result ?? null) as AssistantData | null;

      if (!data || typeof data !== 'object') {
        setError('TaskTrack AI returned an unexpected response. Please try again.');
        setLoading(false);
        return;
      }

      if (data.ok === false) {
        // The function classified the failure, so its exact safe message is shown.
        const message =
          typeof data.error === 'object' && data.error
            ? data.error.message || 'Something went wrong. Please try again.'
            : typeof data.error === 'string' && data.error
              ? data.error
              : 'Something went wrong. Please try again.';
        setError(message);
        if (typeof data.error === 'object' && data.error?.code === 'QUOTA_EXCEEDED') {
          announceCreditsChanged();
        }
        setLoading(false);
        return;
      }

      const rawReply = typeof data.text === 'string' ? data.text : '';
      const structured = data.structured ? parseStructuredResult(mode, data.structured) : null;

      if (!structured && !rawReply.trim()) {
        setError('TaskTrack AI did not return a response. Please try again.');
        setLoading(false);
        return;
      }

      announceCreditsChanged();

      // A generated study plan becomes real, persistent scheduled sessions.
      if (mode === 'plan' && structured) {
        await persistPlan(structured as StudyPlanData);
      }

      // Save successful replies. If saving fails the answer is still shown, so a
      // storage problem never hides a reply the student already paid for with a
      // request from their daily limit.
      let savedAssistant: StudySessionMessage | null = null;
      try {
        savedAssistant = await addMessage({
          sessionId: session.id,
          role: 'assistant',
          content: rawReply,
          mode,
          structuredData: structured ?? null,
        });
        await touchSession(session.id);
      } catch {
        setError('This reply could not be saved to your session.');
      }

      const display: DisplayMessage = savedAssistant
        ? toDisplay(savedAssistant)
        : {
            id: `temp-a-${Date.now()}`,
            role: 'assistant',
            content: rawReply,
            mode: null,
            structured: undefined,
          };
      setMessages((prev) => [
        ...prev,
        { ...display, structured: structured ?? undefined, mode: structured ? mode : null },
      ]);
      onActivity?.();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleComplete = async () => {
    const next = status === 'completed' ? 'active' : 'completed';
    try {
      await setSessionStatus(session.id, next);
      setStatus(next);
      // Completing the session stands down the task's remaining scheduled study
      // sessions, so they leave the upcoming lists while history is preserved.
      if (next === 'completed' && task?.id) {
        await completeStudySessionsForTask(task.id);
        setNextSession(null);
      }
      onStatusChange?.({ ...session, status: next });
      onActivity?.();
    } catch {
      setError('The session status could not be updated. Please try again.');
    }
  };

  const overLimit = input.length > maxChars;
  const showGreeting = messages.length === 0 && !loadingHistory;

  const removeAttachment = (id: string) => {
    // Removes the chip from this session only; no library document is deleted.
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  /**
   * Persist a finished quiz so its score and weak topics survive reloads and can
   * inform revision advice later. Best-effort: the results screen already shows
   * everything the student needs, so a storage failure only logs quietly.
   */
  const saveAttempt = useCallback(
    async (result: QuizResult) => {
      try {
        await saveQuizAttempt({
          sessionId: session.id,
          taskId: task?.id ?? null,
          result,
        });
      } catch {
        // The attempt is not critical to the study flow; skip silently.
      }
    },
    [session.id, task?.id]
  );

  // Latest structured output (quiz, flashcards, plan, slides) to surface as
  // "Current activity" in the workspace's main column.
  const latestStructured =
    [...messages].reverse().find((m) => m.role === 'assistant' && m.structured) ?? null;

  if (!open) return null;

  const subjectColour = task?.subject?.colour || '#315EDB';

  const workspace = (
    <div className="fixed inset-0 z-50 bg-background animate-fade-in overflow-y-auto lg:overflow-hidden">
      <div className="min-h-full lg:h-full flex flex-col">
        {/* Workspace header: navy identity bar */}
        <div className="bg-navy-900 text-white flex-shrink-0 lg:flex-shrink">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-8 py-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <div
                role="img"
                aria-label="TaskTrack"
                title="TaskTrack"
                className="w-8 h-8 rounded-md bg-white/95 flex items-center justify-center flex-shrink-0"
              >
                <Logo size={18} tone="dark" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{session.title}</p>
                <p className="text-[11px] text-slate-300 truncate">
                  {task?.subject?.name || 'General'} · Learning workspace
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              {onNewSession && (
                <button
                  onClick={onNewSession}
                  className="p-2 rounded-md hover:bg-white/10 transition-colors"
                  aria-label="Start a new session for this task"
                  title="New session"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={toggleComplete}
                className="p-2 rounded-md hover:bg-white/10 transition-colors"
                aria-label={status === 'completed' ? 'Reopen session' : 'Mark session complete'}
                title={status === 'completed' ? 'Reopen session' : 'Mark complete'}
              >
                <CheckCircle2 className={cn('w-4 h-4', status === 'completed' && 'text-sky-300')} />
              </button>
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Exit study session"
                title="Exit study session"
              >
                <X className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-medium">Exit</span>
              </button>
            </div>
          </div>
        </div>

        {/* Body: study content first (left), contained assistant (right on desktop) */}
        <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row lg:overflow-hidden">
          {/* ---------- Main content column ---------- */}
          <div className="flex-1 min-w-0 lg:overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 lg:py-8 space-y-8">

              {/* Task overview — open section, no card */}
              <header>
                {task?.subject?.name && (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-medium mb-2"
                    style={{ color: subjectColour }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: subjectColour }} />
                    {task.subject.name}
                  </span>
                )}
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-tight">
                  {task?.title || session.title}
                </h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-xs text-muted-foreground">
                  {task?.category && (
                    <span>{CATEGORY_LABELS[task.category as TaskCategory] ?? task.category}</span>
                  )}
                  {task?.priority && (
                    <span>· {PRIORITY_LABELS[task.priority as Priority] ?? task.priority} priority</span>
                  )}
                  {task?.due_date && (() => {
                    const d = parseISO(task.due_date);
                    return isValid(d) ? (
                      <span className="flex items-center gap-1">
                        · <CalendarDays className="w-3 h-3" /> {format(d, 'd MMM yyyy')}
                      </span>
                    ) : null;
                  })()}
                  {task?.estimated_minutes ? (
                    <span className="flex items-center gap-1">
                      · <Clock className="w-3 h-3" /> {task.estimated_minutes} min
                    </span>
                  ) : null}
                  <span>· {session.message_count} {session.message_count === 1 ? 'message' : 'messages'}</span>
                </div>
                {task?.description && (
                  <p className="text-sm text-muted-foreground mt-3 leading-relaxed max-w-prose">
                    {task.description}
                  </p>
                )}
              </header>

              {/* Submission tasks: offer feedback on a finished draft */}
              {task && isSubmissionTask(task) && (
                <Link
                  href={`/app/grader?task=${encodeURIComponent(task.id)}`}
                  className="group flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5 transition-colors hover:bg-primary/10"
                >
                  <GraderIcon size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">Got a draft? Want it graded?</span>
                    <span className="block text-xs text-muted-foreground">Check it against the criteria before you hand it in.</span>
                  </span>
                  <span className="flex-shrink-0 text-sm font-semibold text-primary group-hover:underline">Grade my work</span>
                </Link>
              )}

              {/* AI context disclosure — honest about what the assistant receives */}
              <AiContextDisclosure
                taskContext={taskContext}
                attachments={attachments}
              />

              {/* Study tools — compact, well-labelled grid with restrained icons */}
              <section aria-label="Study tools">
                <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-3">
                  Study tools
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => {
                        setSelectedMode(option.id);
                        setMobileChatOpen(true);
                        sendMessage(option.prompt, option.id);
                      }}
                      disabled={loading || limitReached}
                      className="text-left px-3 py-2.5 rounded-lg border border-border bg-card hover:border-primary/40 hover:bg-accent/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed group"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground group-hover:text-primary transition-colors">
                          {TOOL_ICONS[option.id]}
                        </span>
                        <span className="text-[13px] font-medium text-foreground">{option.label}</span>
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setUploadOpen(true)}
                  className="mt-2 flex items-center gap-2 text-[13px] font-medium px-3.5 py-2.5 rounded-lg border border-dashed border-border bg-card hover:border-primary/40 hover:bg-accent/50 transition-colors text-foreground"
                >
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                  Upload document
                </button>
              </section>

              {/* Study materials — real file list, honest states */}
              <section aria-label="Study materials">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Study materials
                  </h2>
                  <button
                    onClick={() => setUploadOpen(true)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Add document
                  </button>
                </div>
                {attachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    No documents attached to this session yet. Use “Upload document” to add one —
                    ready documents give the assistant real context from your files.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
                    {attachments.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{a.name}</p>
                          <p className={cn('text-[11px]', a.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                            {a.status === 'failed' ? 'Failed' : 'Attached'} · {formatBytes(a.size)}
                          </p>
                        </div>
                        <button
                          onClick={() => removeAttachment(a.id)}
                          className="tap-target p-1.5 rounded hover:bg-accent transition-colors"
                          aria-label={`Remove ${a.name}`}
                          title={`Remove ${a.name}`}
                        >
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Current activity — latest structured study output surfaced here */}
              <section aria-label="Current activity">
                <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                  Current activity
                </h2>
                {latestStructured ? (
                  <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                      {modeLabel(latestStructured.mode as StudyMode)}
                    </p>
                    <StructuredMessage
                      message={latestStructured}
                      onQuizFinished={saveAttempt}
                      deckDefaults={{ taskId: task?.id ?? null, sessionId: session.id }}
                    />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Nothing yet. Pick a study tool above or ask the assistant — your latest quiz,
                    flashcards, plan or slides will appear here.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Your latest exchanges live in the study assistant panel.
                  </p>
                )}
              </section>

              {/* Task timer row */}
              {task?.estimated_minutes ? (
                <div className="flex items-center gap-3 pt-2 border-t border-border">
                  <CountdownTimer minutes={task.estimated_minutes} />
                  <span className="text-[11px] text-muted-foreground">Task timer</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* ---------- Assistant column: contained rail on desktop, collapsible section on mobile ---------- */}
          <section
            aria-label="Study assistant"
            className="flex flex-col bg-card border-t lg:border-t-0 lg:border-l border-border lg:w-[380px] xl:w-[420px] flex-shrink-0 lg:h-full lg:overflow-hidden"
          >
            <div className="hidden lg:flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Study assistant</h3>
              {credits && (
                <span className="text-[11px] text-muted-foreground" title={`Refills ${refillDate(credits.resetsAt)}`}>
                  {credits.remaining} of {credits.limit} credits left
                </span>
              )}
            </div>

            {/* Mobile tab: opens the assistant section */}
            <button
              onClick={() => setMobileChatOpen((s) => !s)}
              className="lg:hidden flex items-center justify-between px-4 py-3 bg-card border-b border-border text-sm font-medium"
              aria-expanded={mobileChatOpen}
            >
              <span className="flex items-center gap-2">
                Study assistant
                {messages.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">({messages.length})</span>
                )}
              </span>
              <ChevronDown
                className={cn('w-4 h-4 text-muted-foreground transition-transform', mobileChatOpen && 'rotate-180')}
              />
            </button>

            <div
              ref={scrollRef}
              className={cn(
                'flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-background',
                !mobileChatOpen && 'hidden lg:block'
              )}
            >
              {showGreeting && (
                <div className="px-1 py-1">
                  <p className="text-sm font-medium text-foreground">Choose how you want to study.</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    I already know this task&rsquo;s details
                    {task?.subject ? ` (${task.subject.name})` : ''}. Pick a study tool on the left,
                    upload a document, or ask me anything below.
                  </p>
                </div>
              )}

              {loadingHistory && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[90%] rounded-lg px-3.5 py-2 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-accent text-foreground border border-primary/25'
                        : 'bg-card text-foreground border border-border'
                    )}
                  >
                    {msg.role === 'user' ? (
                      <p>{displayContent(msg.mode, msg.content, Boolean(msg.structured))}</p>
                    ) : (
                      <StructuredMessage message={msg} onQuizFinished={saveAttempt} onPractice={practiseSession} deckDefaults={{ taskId: task?.id ?? null, sessionId: session.id }} />
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start" role="status" aria-label="TaskTrack AI is thinking">
                  <div className="bg-card border border-border rounded-lg px-3.5 py-2.5">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">Thinking…</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 text-destructive text-xs">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {limitReached && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs">
                  <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>You&rsquo;ve used all your AI credits for this month. They refill on {refillDate(credits?.resetsAt ?? null)}.</span>
                </div>
              )}
            </div>

            {/* Composer: attachments, typing row, selectors BELOW the input */}
            <div className={cn('border-t border-border bg-card flex-shrink-0', !mobileChatOpen && 'hidden lg:block')}>
              {attachments.length > 0 && (
                <div className="px-4 pt-2.5 flex flex-wrap gap-1.5">
                  {attachments.map((a) => (
                    <span
                      key={a.id}
                      className={cn(
                        'inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border',
                        a.status === 'failed'
                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : 'border-border bg-background text-foreground'
                      )}
                    >
                      <FileText className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                      <span className="max-w-[140px] truncate">{a.name}</span>
                      <span className="text-muted-foreground">{formatBytes(a.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.id)}
                        className="rounded hover:bg-foreground/10 p-0.5"
                        aria-label={`Remove ${a.name} from this session`}
                        title="Remove from session"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage(input, selectedMode);
                }}
                className="flex items-center gap-2 px-4 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  className="w-9 h-9 rounded-md border border-border bg-background hover:bg-accent text-foreground flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Upload document"
                  title="Upload document"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={limitReached ? 'No AI credits left this month' : 'Ask a question about this task…'}
                  disabled={loading || limitReached}
                  className="flex-1 min-w-0 px-3.5 py-2 rounded-md bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim() || limitReached || overLimit}
                  className="w-9 h-9 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                  aria-label="Send message"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : limitReached ? (
                    <Lock className="w-4 h-4" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>

              {/* Selectors live BELOW the typing area */}
              <div className="px-4 pb-3 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  {AI_OPTIONS.map((option) => {
                    const selected = selectedAi === option.id;
                    const locked = option.premiumOnly && !isPro;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          if (locked) {
                            setAiNotice({
                              kind: 'info',
                              text: 'Study Bot is part of Premium. Upgrade to unlock Study Bot — it uses the same AI credits.',
                            });
                            return;
                          }
                          setSelectedAi(option.id);
                          setAiNotice(null);
                        }}
                        title={option.description}
                        aria-pressed={selected}
                        className={cn(
                          'inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border transition-colors',
                          selected
                            ? 'bg-accent border-primary/40 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
                        )}
                      >
                        {option.id === 'study-bot' ? <Crown className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                        {option.label}
                        {locked && <Lock className="w-2.5 h-2.5" />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="study-mode-select" className="text-[11px] text-muted-foreground flex-shrink-0">
                    Mode
                  </label>
                  <select
                    id="study-mode-select"
                    value={selectedMode}
                    onChange={(e) => setSelectedMode(e.target.value as StudyMode)}
                    disabled={loading}
                    aria-label="Study mode for the next message"
                    className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                  >
                    {MODE_SELECT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className={cn('text-[10px] whitespace-nowrap flex-shrink-0', overLimit ? 'text-destructive' : 'text-muted-foreground')}>
                    {input.length}/{maxChars}
                  </span>
                </div>
                {aiNotice && (
                  <div
                    className={cn(
                      'flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[11px]',
                      aiNotice.kind === 'error'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-accent text-primary'
                    )}
                  >
                    {aiNotice.kind === 'error' ? (
                      <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    ) : (
                      <Crown className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    )}
                    <span>{aiNotice.text}</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        {uploadOpen && (
          <UploadDialog
            onClose={() => setUploadOpen(false)}
            isPro={isPro}
            onAttached={(chip) => setAttachments((prev) => [...prev, chip])}
          />
        )}
      </div>
    </div>
  );

  return portalReady ? createPortal(workspace, document.body) : workspace;
}

/** The task details column: task facts plus the next scheduled study session. */
function TaskDetailsPanel({
  task,
  subjectColour,
  nextSession,
  scheduling,
  onSchedule,
}: {
  task: StudySessionTask;
  subjectColour: string;
  nextSession: ScheduledStudySession | null;
  scheduling: boolean;
  onSchedule: () => void;
}) {
  const due = task.due_date ? parseISO(task.due_date) : null;
  const dueLabel = due && isValid(due) ? format(due, 'd MMMM yyyy') : null;
  const next = nextSession ? new Date(nextSession.scheduled_for) : null;
  const nextValid = next && !Number.isNaN(next.getTime()) ? next : null;

  const priorities: Record<string, string> = {
    low: 'text-slate-600 dark:text-slate-300',
    medium: 'text-blue-600 dark:text-blue-300',
    high: 'text-amber-600 dark:text-amber-300',
    urgent: 'text-red-600 dark:text-red-300',
  };

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div>
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: `${subjectColour}15`, color: subjectColour }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: subjectColour }} />
          {task.subject?.name || 'No subject'}
        </span>
        <p className="text-sm font-semibold mt-2 leading-snug">{task.title}</p>
        {summary(task.description) && (
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {summary(task.description, 180)}
          </p>
        )}
      </div>

      <dl className="space-y-2.5 text-xs">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Category</dt>
          <dd className="text-right font-medium">
            {CATEGORY_LABELS[task.category as TaskCategory] ?? task.category}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Priority</dt>
          <dd className={cn('text-right font-medium', priorities[task.priority] || '')}>
            {PRIORITY_LABELS[task.priority as Priority] ?? task.priority}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Due date</dt>
          <dd className="text-right font-medium">{dueLabel || 'Not set'}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="text-right font-medium">
            {task.estimated_minutes ? `${task.estimated_minutes} minutes` : 'Not set'}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-right font-medium capitalize">{task.status.replace('_', ' ')}</dd>
        </div>
      </dl>

      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
          Next study session
        </p>
        {nextValid ? (
          <div className="space-y-1">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-primary" />
              {format(nextValid, 'd MMMM yyyy')}
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {format(nextValid, 'h:mm a')}
              {(() => {
                const mins = nextSession?.duration_minutes ?? task.estimated_minutes;
                return mins ? ` \u00b7 ${mins} minutes` : '';
              })()}
            </p>
            {nextSession?.message && (
              <p className="text-xs text-muted-foreground leading-relaxed">{nextSession.message}</p>
            )}
            <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-medium capitalize">
              {nextSession?.status ?? 'scheduled'}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No study session scheduled yet</p>
        )}
        <button
          onClick={onSchedule}
          disabled={scheduling}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors disabled:opacity-50"
        >
          {scheduling ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CalendarPlus className="w-3.5 h-3.5" />
          )}
          Schedule study session
        </button>
      </div>
    </div>
  );
}

/**
 * Honest summary of exactly what the assistant receives with each request: the
 * task's own fields plus any ready attached documents. Says plainly that
 * calendar-imported tasks often carry little detail, so the student knows why
 * answers may be general.
 */
function AiContextDisclosure({
  taskContext,
  attachments,
}: {
  taskContext: StudyTask;
  attachments: AttachmentChip[];
}) {
  const [open, setOpen] = useState(false);

  const taskBits = [
    taskContext.subject ? `Subject: ${taskContext.subject}` : null,
    taskContext.category ? CATEGORY_LABELS[taskContext.category as TaskCategory] ?? taskContext.category : null,
    taskContext.dueDate ? 'Due date' : null,
    taskContext.estimatedMinutes ? 'Estimated time' : null,
    taskContext.priority ? 'Priority' : null,
  ].filter((v): v is string => Boolean(v));

  const readyDocs = attachments.filter((a) => a.status === 'ready' && a.documentId);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          What the assistant can see
        </span>
        <ChevronDown
          className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-2 text-xs text-muted-foreground leading-relaxed">
          <p>
            TaskTrack AI is sent the details of this task when you message it. Right now that
            includes:
          </p>
          <ul className="list-disc pl-4 space-y-0.5 text-foreground">
            <li>The task title{taskBits.length > 0 ? `, plus ${taskBits.join(', ').toLowerCase()}` : ' only'}</li>
            {taskContext.description && <li>The task description you can read above</li>}
            {readyDocs.length > 0 ? (
              <li>
                {readyDocs.length} ready document{readyDocs.length === 1 ? '' : 's'}:{' '}
                {readyDocs.map((a) => a.name).join(', ')} — quotes are cited with page numbers
              </li>
            ) : (
              <li>No attached documents yet — upload one to give it your real materials</li>
            )}
          </ul>
          <p>
            Tasks imported from a school calendar often carry only a title and date, so if the task
            looks thin here the assistant&rsquo;s answers will be general. Add details to the task or
            attach your class materials for specific help.
          </p>
        </div>
      )}
    </div>
  );
}

/** Render an assistant message as a structured view when available, else markdown. */
function StructuredMessage({
  message,
  onQuizFinished,
  onPractice,
  deckDefaults,
}: {
  message: DisplayMessage;
  onQuizFinished?: (result: QuizResult) => void;
  /** Starts an exam-practice round for one session of a study plan. */
  onPractice?: (session: PlanSession) => void;
  /** Links a saved deck back to this task and session. */
  deckDefaults?: { taskId: string | null; sessionId: string };
}) {
  if (message.structured && message.mode) {
    return (
      <div className="space-y-2 w-full">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {modeLabel(message.mode)}
        </p>
        {message.mode === 'quiz' && (
          <QuizView data={message.structured as QuizData} onFinish={onQuizFinished} />
        )}
        {message.mode === 'flashcards' && (
          <FlashcardsView
            data={message.structured as FlashcardsData}
            deckDefaults={deckDefaults}
          />
        )}
        {message.mode === 'plan' && <PlanView data={message.structured as StudyPlanData} onPractice={onPractice} />}
        {message.mode === 'slides' && <SlidesView data={message.structured as SlidesData} />}
      </div>
    );
  }
  return (
    <MarkdownRenderer
      content={displayContent(message.mode, message.content, Boolean(message.structured))}
    />
  );
}

// ---------------------------------------------------------------------------
// Document upload dialog
// ---------------------------------------------------------------------------

interface UploadDialogProps {
  onClose: () => void;
  isPro: boolean;
  /** Called with a chip for every document that finished processing as ready. */
  onAttached: (chip: AttachmentChip) => void;
}

interface QueueItem {
  id: string;
  file: File;
  phase: 'queued' | 'transferring' | 'processing' | 'ready' | 'failed';
  progress: number;
  error: string | null;
  documentId?: string;
}

/**
 * The single shared upload entry point: drag-and-drop on desktop and the file
 * picker on mobile both run through the same validation and upload path. Each
 * file goes reserve -> transfer (with live progress) -> processing. Files whose
 * text extraction is not supported yet fail honestly and never count against
 * the monthly allowance.
 */
function UploadDialog({ onClose, isPro, onAttached }: UploadDialogProps) {
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploadUsage, setUploadUsage] = useState<{ used: number; limit: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const monthlyLimit = isPro ? UPLOAD_LIMITS.pro : UPLOAD_LIMITS.free;

  // Load this month's charged usage so the student sees real remaining allowance.
  useEffect(() => {
    let cancelled = false;
    getUploadUsage()
      .then((usage) => { if (!cancelled) setUploadUsage(usage); })
      .catch(() => { if (!cancelled) setUploadUsage(null); });
    return () => { cancelled = true; };
  }, []);

  const patchItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const startUploads = (files: File[]) => {
    setFileError(null);
    const accepted: QueueItem[] = [];
    for (const file of files) {
      const reason = validateFile(file);
      if (reason) {
        setFileError(reason);
        continue;
      }
      accepted.push({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        phase: 'queued',
        progress: 0,
        error: null,
      });
    }
    if (accepted.length === 0) return;

    setQueue((prev) => [...prev, ...accepted]);

    for (const item of accepted) {
      void (async () => {
        patchItem(item.id, { phase: 'transferring', progress: 0 });
        const result = await uploadDocument(item.file, (phase, fraction) => {
          patchItem(item.id, { phase, progress: Math.round(fraction * 100) });
        });
        if (result.status === 'ready') {
          patchItem(item.id, { phase: 'ready', progress: 100, documentId: result.documentId });
          onAttached({
            id: result.documentId,
            name: item.file.name,
            size: item.file.size,
            status: 'ready',
            documentId: result.documentId,
          });
        } else {
          patchItem(item.id, { phase: 'failed', error: result.error });
        }
      })();
    }
  };

  const removeItem = (id: string) => setQueue((prev) => prev.filter((q) => q.id !== id));
  const busy = queue.some((q) => q.phase === 'queued' || q.phase === 'transferring' || q.phase === 'processing');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upload document"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Upload document</h3>
          <button onClick={onClose} aria-label="Close upload dialog" className="tap-target p-1 rounded-md hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!busy) startUploads(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            'rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border'
          )}
        >
          <Paperclip className="w-6 h-6 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium mt-2">Drag and drop documents here</p>
          <p className="text-xs text-muted-foreground mt-1">or</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-3 text-xs font-medium px-3 py-2 rounded-lg bg-navy-600 text-white hover:bg-navy-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Choose files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILE_TYPES.join(',')}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) startUploads(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
        </div>

        {queue.length > 0 && (
          <ul className="space-y-1.5">
            {queue.map((q) => (
              <li key={q.id} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 truncate">{q.file.name}</span>
                  <span className="text-muted-foreground">{formatBytes(q.file.size)}</span>
                  {q.phase === 'ready' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : q.phase === 'failed' ? (
                    <button
                      onClick={() => removeItem(q.id)}
                      aria-label={`Dismiss ${q.file.name}`}
                      className="p-0.5 rounded-full hover:bg-foreground/10"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                {(q.phase === 'transferring' || q.phase === 'processing') && (
                  <div className="mt-1.5">
                    <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn('h-full rounded-full bg-primary transition-all', q.phase === 'processing' && 'animate-pulse')}
                        style={{ width: q.phase === 'processing' ? '100%' : `${q.progress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {q.phase === 'transferring' ? `Uploading… ${q.progress}%` : 'Processing…'}
                    </p>
                  </div>
                )}
                {q.phase === 'failed' && q.error && (
                  <p className="mt-1 text-[11px] text-destructive leading-relaxed">{q.error}</p>
                )}
                {q.phase === 'ready' && (
                  <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                    Ready — attached to this session.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {fileError && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 text-destructive px-3 py-2 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{fileError}</span>
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          <p>PDF, Word, PowerPoint, text, markdown, images (PNG/JPG/WebP), CSV, Excel. 20 MB maximum per document.</p>
          <p>
            {isPro ? 'Pro' : 'Free'} allowance: {uploadUsage ? `${uploadUsage.used}/${uploadUsage.limit}` : monthlyLimit} successful{' '}
            {uploadUsage ? '' : 'uploads/'}month. Only files that process successfully count.
          </p>
          <p>Text extraction works for text, markdown, CSV and PDF text layers today. Scanned, password-protected, Word, PowerPoint and image files cannot be read yet and do not consume your allowance.</p>
        </div>

        <button
          type="button"
          disabled={busy || queue.every((q) => q.phase !== 'ready')}
          onClick={() => { onClose(); }}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2.5 rounded-lg bg-navy-600 text-white hover:bg-navy-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Paperclip className="w-4 h-4" />
          Done
        </button>
      </div>
    </div>
  );
}
