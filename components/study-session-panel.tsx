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
  PlayCircle, ExternalLink, RefreshCw, Brain, Target, Stethoscope, Zap, Puzzle, Scale, NotebookPen, Languages, ScrollText, GraduationCap,
} from 'lucide-react';
import { VideoPlayerProvider } from '@/components/video-player';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { saysWorkIsDone } from '@/lib/managebac-submit';
import {
  getLiveDocStatus, startGoogleDocsConnect, createLiveDoc, updateLiveDoc, unlinkLiveDoc,
  setLiveDocAutoUpdate, type LiveDocStatus,
} from '@/lib/google-docs';
import { Logo } from '@/components/logo';
import { QuizView, FlashcardsView, PlanView, SlidesView, VideosView } from '@/components/study-views';
import { CountdownTimer } from '@/components/countdown-timer';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useAiCredits, announceCreditsChanged, refillDate } from '@/lib/ai-credits';
import { getProfileEntitlements, isPaidPlan, resolvePlan } from '@/lib/entitlements';
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
  MODE_OPTIONS, MODE_SELECT_OPTIONS, MODE_BLURBS, PERSONAS,
  suggestMode, suggestionReason, replyChips,
  toTaskContext,
  parseStructuredResult,
  displayContent,
  modeLabel,
  type StudyMode,
  type AiPersona,
  type StudyTask,
  type QuizData,
  type FlashcardsData,
  type StudyPlanData,
  type PlanSession,
  type SlidesData,
  type VideosData,
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
  videos: <PlayCircle className="w-4 h-4" />,
  hints: <Brain className="w-4 h-4" />,
  teachback: <GraduationCap className="w-4 h-4" />,
  commandterms: <Target className="w-4 h-4" />,
  mistakes: <Stethoscope className="w-4 h-4" />,
  speed: <Zap className="w-4 h-4" />,
  memory: <Puzzle className="w-4 h-4" />,
  debate: <Scale className="w-4 h-4" />,
  essayplan: <NotebookPen className="w-4 h-4" />,
  language: <Languages className="w-4 h-4" />,
  summarise: <ScrollText className="w-4 h-4" />,
};

const PERSONA_KEY = 'tasktrack.ai.persona';
const SUGGEST_KEY = 'tasktrack.ai.suggested';
/** The original tools; the rest are listed under "More ways to study". */
const CORE_MODES = new Set<StudyMode>(['explain', 'flashcards', 'quiz', 'plan', 'practice', 'examples', 'slides', 'videos']);

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
  const [persona, setPersona] = useState<AiPersona>('friend');
  const [christmasOn, setChristmasOn] = useState(false);
  const [suggestion, setSuggestion] = useState<StudyMode | null>(null);
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [aiNotice, setAiNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const isPro = isPaidPlan(resolvePlan(profile));
  const [status, setStatus] = useState(session.status);
  const [nextSession, setNextSession] = useState<ScheduledStudySession | null>(null);
  const [scheduling, setScheduling] = useState(false);
  // On phones the workspace shows either the chat or the task & tools.
  const [mobileTab, setMobileTab] = useState<'chat' | 'tools'>('chat');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Portals need a browser-side target; rendering them on the server would throw.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);

  // The chosen personality is remembered on this device. Santa only exists while
  // Christmas mode is on.
  useEffect(() => {
    const xmas = document.documentElement.classList.contains('christmas');
    setChristmasOn(xmas);
    try {
      const saved = window.localStorage.getItem(PERSONA_KEY) as AiPersona | null;
      if (saved && PERSONAS.some((p) => p.id === saved) && (saved !== 'santa' || xmas)) setPersona(saved);
    } catch {
      // fine
    }
  }, [open]);

  const choosePersona = (p: AiPersona) => {
    setPersona(p);
    try {
      window.localStorage.setItem(PERSONA_KEY, p);
    } catch {
      // fine
    }
  };

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

  // Suggest the one study tool that fits this task best, once per task.
  useEffect(() => {
    if (!open || loadingHistory) return;
    const key = task?.id || session.id;
    let seen: string[] = [];
    try {
      seen = JSON.parse(window.localStorage.getItem(SUGGEST_KEY) || '[]');
    } catch {
      seen = [];
    }
    if (!Array.isArray(seen) || seen.includes(key)) return;
    const t = window.setTimeout(() => {
      setSuggestion(suggestMode({
        title: task?.title || session.title,
        subject: task?.subject?.name ?? null,
        description: task?.description ?? null,
        category: task?.category ?? null,
      }));
      try {
        window.localStorage.setItem(SUGGEST_KEY, JSON.stringify([...seen, key].slice(-200)));
      } catch {
        // fine
      }
    }, 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadingHistory, session.id, task?.id]);

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
    setMobileTab('chat');
    sendMessage(`Give me an exam-style practice question on: ${plan.focus}${topics}.${plan.practice ? ` Plan task: ${plan.practice}` : ''}`, 'practice');
  };

  // ---- Live Google Doc ----
  const [docStatus, setDocStatus] = useState<LiveDocStatus | null>(null);
  const [docBusy, setDocBusy] = useState<'idle' | 'connecting' | 'creating' | 'updating'>('idle');
  const [docError, setDocError] = useState<string | null>(null);
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const docRunning = useRef(false);
  const docPending = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDocStatus(null);
    getLiveDocStatus(session.id).then((res) => {
      if (!cancelled && res.ok) setDocStatus(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, session.id]);

  /** Rewrite the live doc from the latest chat; overlapping requests are coalesced. */
  const refreshDoc = useCallback(async () => {
    if (docRunning.current) {
      docPending.current = true;
      return;
    }
    docRunning.current = true;
    setDocBusy('updating');
    setDocError(null);
    try {
      do {
        docPending.current = false;
        const res = await updateLiveDoc(session.id);
        if (res.ok) {
          setDocStatus((prev) => (prev ? { ...prev, doc: res.data.doc } : prev));
          announceCreditsChanged();
        } else {
          setDocError(res.error);
          if (res.code === 'MISSING_DOC') setDocStatus((prev) => (prev ? { ...prev, doc: null } : prev));
          if (res.code === 'RECONNECT') setDocStatus((prev) => (prev ? { ...prev, connected: false, needsReconnect: true, doc: prev.doc } : prev));
          break;
        }
      } while (docPending.current);
    } finally {
      docRunning.current = false;
      setDocBusy('idle');
    }
  }, [session.id]);

  const connectDocs = async () => {
    setDocBusy('connecting');
    setDocError(null);
    const res = await startGoogleDocsConnect(session.id);
    if (res.ok) {
      window.location.assign(res.data.url);
      return;
    }
    setDocError(res.error);
    setDocBusy('idle');
  };

  const createDoc = async () => {
    setDocBusy('creating');
    setDocError(null);
    const res = await createLiveDoc(session.id);
    setDocBusy('idle');
    if (!res.ok) {
      setDocError(res.error);
      if (res.code === 'NOT_CONNECTED' || res.code === 'RECONNECT') {
        setDocStatus((prev) => (prev ? { ...prev, connected: false, needsReconnect: res.code === 'RECONNECT' } : prev));
      }
      return;
    }
    setDocStatus((prev) => (prev ? { ...prev, doc: res.data.doc } : prev));
    announceCreditsChanged();
  };

  const toggleDocAuto = async (on: boolean) => {
    setDocStatus((prev) => (prev?.doc ? { ...prev, doc: { ...prev.doc, autoUpdate: on } } : prev));
    const saved = await setLiveDocAutoUpdate(session.id, on);
    if (!saved) {
      setDocStatus((prev) => (prev?.doc ? { ...prev, doc: { ...prev.doc, autoUpdate: !on } } : prev));
      setDocError('That setting could not be saved. Please try again.');
    }
  };

  const stopDoc = async () => {
    const res = await unlinkLiveDoc(session.id);
    if (res.ok) {
      setDocStatus((prev) => (prev ? { ...prev, doc: null } : prev));
      setDocDialogOpen(false);
    } else {
      setDocError(res.error);
    }
  };

  const sendMessage = async (text: string, mode: StudyMode) => {
    if (!text.trim() || loading || limitReached) return;

    if (text.length > maxChars) {
      setError(`Your message is too long. Please keep it under ${maxChars.toLocaleString()} characters.`);
      return;
    }

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
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

      // "I'm done" on a ManageBac task that's handed in online: reply with the link
      // to submit it on ManageBac instead of asking the AI (no credits used).
      let submitReply: string | null = null;
      if (mode === 'chat' && task?.id && task.external_source === 'managebac_calendar' && saysWorkIsDone(text)) {
        try {
          const { data: link } = await supabase.functions.invoke('managebac-submit-link', {
            body: { taskId: task.id },
          });
          if (link?.ok && typeof link.text === 'string' && link.text) submitReply = link.text;
        } catch {
          submitReply = null;
        }
      }

      const { data: result, error: invokeError } = submitReply
        ? { data: { ok: true, mode, text: submitReply } as AssistantData, error: null }
        : mode === 'videos'
        // Video plan: an ordered Video 1, Video 2… course, made by its own small function.
        ? await supabase.functions.invoke('video-plan', {
            body: {
              task: taskContext,
              messages: history.map((m) => ({ role: m.role, content: m.content })),
            },
          })
        : await supabase.functions.invoke(
        'study-session-chat',
        {
          body: {
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            task: taskContext,
            mode,
            persona,
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
      // Keep the live Google Doc in step with the conversation.
      if (docStatus?.doc?.autoUpdate) void refreshDoc();
      // One-off activities (speed round, quiz, flashcards, slides, plan, videos) are
      // done once their result arrives, so the next typed message is a normal chat
      // rather than another round of the same activity.
      if (structured) setSelectedMode('chat');
      onActivity?.();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const startMode = (mode: StudyMode) => {
    const option = MODE_OPTIONS.find((o) => o.id === mode);
    if (!option) return;
    setSuggestion(null);
    setSelectedMode(mode);
    setMobileTab('chat');
    sendMessage(option.prompt, mode);
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

  if (!open) return null;

  const subjectColour = task?.subject?.colour || '#315EDB';
  const dueDate = task?.due_date ? parseISO(task.due_date) : null;
  const dueValid = dueDate && isValid(dueDate) ? dueDate : null;
  const starterModes = MODE_OPTIONS.filter((o) => ['explain', 'quiz', 'flashcards', 'plan'].includes(o.id));
  const personaOptions = PERSONAS.filter((p) => p.id !== 'santa' || christmasOn);
  const lastMessage = messages[messages.length - 1];
  const showReplyChips =
    !loading && !limitReached && lastMessage?.role === 'assistant' && !lastMessage.structured;
  const nearLimit = input.length > maxChars * 0.8;

  const chooseAi = (id: AiOptionId) => {
    const option = AI_OPTIONS.find((o) => o.id === id);
    if (option?.premiumOnly && !isPro) {
      setAiNotice({
        kind: 'info',
        text: 'Study Bot is part of Premium. Upgrade to unlock Study Bot — it uses the same AI credits.',
      });
      return;
    }
    setSelectedAi(id);
    setAiNotice(null);
  };

  const submitComposer = () => {
    if (!input.trim()) return;
    sendMessage(input, selectedMode);
  };

  const suggestionOption = suggestion ? MODE_OPTIONS.find((o) => o.id === suggestion) : null;

  /** Task, tools and materials: the left rail on desktop, the "Tools" tab on phones. */
  const toolsColumn = (
    <div className="px-4 sm:px-5 py-5 space-y-6">
      {/* Task overview */}
      <section aria-label="Task" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        {task?.subject?.name && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: `${subjectColour}18`, color: subjectColour }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: subjectColour }} />
            {task.subject.name}
          </span>
        )}
        <h1 className="mt-2 text-lg font-bold leading-snug tracking-tight text-foreground">
          {task?.title || session.title}
        </h1>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          {task?.category && (
            <span className="rounded-md bg-muted px-2 py-0.5">
              {CATEGORY_LABELS[task.category as TaskCategory] ?? task.category}
            </span>
          )}
          {task?.priority && (
            <span className="rounded-md bg-muted px-2 py-0.5">
              {PRIORITY_LABELS[task.priority as Priority] ?? task.priority} priority
            </span>
          )}
          {dueValid && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
              <CalendarDays className="h-3 w-3" /> Due {format(dueValid, 'd MMM')}
            </span>
          )}
          {task?.estimated_minutes ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
              <Clock className="h-3 w-3" /> {task.estimated_minutes} min
            </span>
          ) : null}
        </div>
        {task?.description && (
          <div className="mt-3">
            <p className={cn('text-xs leading-relaxed text-muted-foreground', !detailsOpen && 'line-clamp-3')}>
              {task.description}
            </p>
            {task.description.length > 160 && (
              <button
                type="button"
                onClick={() => setDetailsOpen((o) => !o)}
                className="mt-1 text-xs font-medium text-primary hover:underline"
              >
                {detailsOpen ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
        {task?.estimated_minutes ? (
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <CountdownTimer minutes={task.estimated_minutes} />
            <span className="text-[11px] text-muted-foreground">Task timer</span>
          </div>
        ) : null}
      </section>

      {/* Submission tasks: offer feedback on a finished draft */}
      {task && isSubmissionTask(task) && (
        <Link
          href={`/app/grader?task=${encodeURIComponent(task.id)}`}
          className="group flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3 transition-colors hover:bg-primary/10"
        >
          <GraderIcon size={32} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">Got a draft?</span>
            <span className="block text-[11px] text-muted-foreground">Check it against the criteria first.</span>
          </span>
          <span className="flex-shrink-0 text-xs font-semibold text-primary group-hover:underline">Grade it</span>
        </Link>
      )}

      {/* Study tools */}
      <section aria-label="Study tools">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Study tools</h2>
        <div className="grid grid-cols-2 gap-2">
          {MODE_OPTIONS.filter((o) => CORE_MODES.has(o.id)).map((option) => (
            <button
              key={option.id}
              onClick={() => startMode(option.id)}
              disabled={loading || limitReached}
              className="group flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {TOOL_ICONS[option.id]}
              </span>
              <span className="text-[13px] font-medium leading-tight text-foreground">{option.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setMoreToolsOpen((o) => !o)}
          aria-expanded={moreToolsOpen}
          className="mt-4 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          More ways to study
          <ChevronDown className={cn('h-4 w-4 transition-transform', moreToolsOpen && 'rotate-180')} />
        </button>
        {moreToolsOpen && (
          <div className="mt-2 space-y-1">
            {MODE_OPTIONS.filter((o) => !CORE_MODES.has(o.id)).map((option) => (
              <button
                key={option.id}
                onClick={() => startMode(option.id)}
                disabled={loading || limitReached}
                className="group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="mt-0.5 text-muted-foreground transition-colors group-hover:text-primary">{TOOL_ICONS[option.id]}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-foreground">{option.label}</span>
                  {MODE_BLURBS[option.id] && (
                    <span className="block text-[11px] leading-snug text-muted-foreground">{MODE_BLURBS[option.id]}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Study materials */}
      <section aria-label="Study materials">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your materials</h2>
          <button onClick={() => setUploadOpen(true)} className="text-xs font-medium text-primary hover:underline">
            Add
          </button>
        </div>
        {attachments.length === 0 ? (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border bg-card/60 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50"
          >
            <Paperclip className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="text-xs leading-snug text-muted-foreground">
              Upload notes or a task sheet so answers use your real class materials.
            </span>
          </button>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className={cn('text-[11px]', a.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                    {a.status === 'failed' ? 'Failed' : 'Attached'} · {formatBytes(a.size)}
                  </p>
                </div>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="tap-target rounded p-1.5 transition-colors hover:bg-accent"
                  aria-label={`Remove ${a.name}`}
                  title={`Remove ${a.name}`}
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What the AI is sent — honest about its context */}
      <AiContextDisclosure taskContext={taskContext} attachments={attachments} />
    </div>
  );

  const workspace = (
    <VideoPlayerProvider>
    {suggestionOption && (
      <div
        role="dialog"
        aria-label="Suggested study tool"
        className="fixed bottom-28 left-1/2 z-[60] w-[min(92vw,420px)] -translate-x-1/2 animate-suggest-in rounded-2xl border border-primary/30 bg-card p-4 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {TOOL_ICONS[suggestionOption.id]}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">💡 Try this for this task</p>
            <p className="mt-0.5 font-semibold">{suggestionOption.label}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {suggestionReason(suggestionOption.id, { subject: task?.subject?.name ?? null })}
            </p>
          </div>
          <button onClick={() => setSuggestion(null)} aria-label="Close suggestion" className="tap-target rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setSuggestion(null)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent">
            Not now
          </button>
          <button
            onClick={() => startMode(suggestionOption.id)}
            disabled={loading || limitReached}
            className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Try it
          </button>
        </div>
      </div>
    )}
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      {/* Header */}
      <header className="flex-shrink-0 bg-navy-900 text-white">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div
              role="img"
              aria-label="TaskTrack"
              title="TaskTrack"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/95"
            >
              <Logo size={18} tone="dark" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{session.title}</p>
              <p className="truncate text-[11px] text-slate-300">
                {task?.subject?.name || 'General'} · Study session
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1 sm:gap-1.5">
            <button
              onClick={() => setDocDialogOpen(true)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                docStatus?.doc ? 'bg-sky-400/20 text-sky-100 hover:bg-sky-400/30' : 'hover:bg-white/10'
              )}
              aria-label="Live Google Doc"
              title="Live Google Doc"
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Live doc</span>
              {docStatus?.doc && (
                <span className={cn('h-1.5 w-1.5 rounded-full bg-sky-300', docBusy === 'updating' && 'animate-pulse')} />
              )}
            </button>
            {credits && (
              <span
                className={cn(
                  'mr-1 hidden items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex',
                  credits.remaining === 0 ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10 text-slate-200'
                )}
                title={`Refills ${refillDate(credits.resetsAt)}`}
              >
                <Sparkles className="h-3 w-3" />
                {credits.remaining} credits
              </span>
            )}
            {onNewSession && (
              <button
                onClick={onNewSession}
                className="rounded-lg p-2 transition-colors hover:bg-white/10"
                aria-label="Start a new session for this task"
                title="New session"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={toggleComplete}
              className="rounded-lg p-2 transition-colors hover:bg-white/10"
              aria-label={status === 'completed' ? 'Reopen session' : 'Mark session complete'}
              title={status === 'completed' ? 'Reopen session' : 'Mark complete'}
            >
              <CheckCircle2 className={cn('h-4 w-4', status === 'completed' && 'text-sky-300')} />
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 py-1.5 pl-2.5 pr-3 transition-colors hover:bg-white/20"
              aria-label="Exit study session"
              title="Exit study session"
            >
              <X className="h-4 w-4 flex-shrink-0" />
              <span className="text-xs font-medium">Exit</span>
            </button>
          </div>
        </div>

        {/* Phones: switch between the chat and the task/tools */}
        <div className="px-3 pb-2.5 lg:hidden" role="tablist" aria-label="Study session view">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/10 p-1">
            {([
              { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-3.5 w-3.5" /> },
              { id: 'tools', label: 'Task & tools', icon: <ListChecks className="h-3.5 w-3.5" /> },
            ] as const).map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={mobileTab === t.id}
                onClick={() => setMobileTab(t.id)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-colors',
                  mobileTab === t.id ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-200 hover:bg-white/10'
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------- Task & tools rail ---------- */}
        <aside
          aria-label="Task and study tools"
          className={cn(
            'min-h-0 w-full flex-shrink-0 overflow-y-auto bg-muted/30 lg:block lg:w-[340px] lg:border-r lg:border-border xl:w-[370px]',
            mobileTab === 'tools' ? 'block' : 'hidden'
          )}
        >
          {toolsColumn}
        </aside>

        {/* ---------- Chat ---------- */}
        <section
          aria-label="Study assistant"
          className={cn('min-h-0 min-w-0 flex-1 flex-col', mobileTab === 'chat' ? 'flex' : 'hidden lg:flex')}
        >
          {docStatus?.doc && (
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-sky-50/70 px-4 py-2 text-xs dark:bg-sky-950/20 sm:px-6">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-sky-600 text-white">
                <FileText className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                <span className="font-semibold">Live doc</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {docBusy === 'updating'
                    ? 'Writing your latest notes…'
                    : docError
                      ? docError
                      : !docStatus.doc.autoUpdate
                        ? 'Paused'
                        : docStatus.doc.lastWrittenAt
                          ? `Updated ${format(new Date(docStatus.doc.lastWrittenAt), 'h:mm a')}`
                          : 'Updates as you chat'}
                </span>
              </span>
              {docBusy === 'updating' && <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-sky-600" />}
              <a
                href={docStatus.doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 font-semibold text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/40"
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
              {showGreeting && (
                <div className="flex flex-col items-center px-2 pb-2 pt-6 text-center sm:pt-12">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                    <Sparkles className="h-7 w-7" />
                  </div>
                  <h2 className="mt-4 text-xl font-bold tracking-tight text-foreground">
                    {persona === 'santa' ? 'Ho ho ho! 🎅' : persona === 'hype' ? 'LET’S GO! 🔥' : persona === 'teacher' ? 'Let’s get to work.' : 'Hey! 👋'}{' '}
                    Ready when you are.
                  </h2>
                  <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                    I&rsquo;ve already read <span className="font-medium text-foreground">{task?.title || session.title}</span>
                    {task?.subject ? ` (${task.subject.name})` : ''}. Ask me anything, or start with one of these.
                  </p>
                  <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                    {starterModes.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => startMode(option.id)}
                        disabled={loading || limitReached}
                        className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                      >
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          {TOOL_ICONS[option.id]}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground">{option.label}</span>
                          {MODE_BLURBS[option.id] && (
                            <span className="block truncate text-[11px] text-muted-foreground">{MODE_BLURBS[option.id]}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {loadingHistory && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {messages.map((msg) =>
                msg.role === 'user' ? (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
                      {displayContent(msg.mode, msg.content, Boolean(msg.structured))}
                    </div>
                  </div>
                ) : (
                  <div key={msg.id} className="flex items-start gap-3">
                    <AssistantAvatar />
                    <div
                      className={cn(
                        'min-w-0 flex-1 text-sm leading-relaxed text-foreground',
                        Boolean(msg.structured) && 'rounded-2xl border border-border bg-card p-4 shadow-sm'
                      )}
                    >
                      <StructuredMessage
                        message={msg}
                        onQuizFinished={saveAttempt}
                        onPractice={practiseSession}
                        deckDefaults={{ taskId: task?.id ?? null, sessionId: session.id }}
                      />
                    </div>
                  </div>
                )
              )}

              {showReplyChips && (
                <div className="flex flex-wrap gap-1.5 pl-11" aria-label="Quick replies">
                  {replyChips(selectedMode).map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => {
                        if (chip.mode) {
                          startMode(chip.mode);
                        } else {
                          sendMessage(chip.text, selectedMode);
                        }
                      }}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}

              {loading && (
                <div className="flex items-start gap-3" role="status" aria-label="TaskTrack AI is thinking">
                  <AssistantAvatar />
                  <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-muted px-4 py-3">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {limitReached && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>You&rsquo;ve used all your AI credits for this month. They refill on {refillDate(credits?.resetsAt ?? null)}.</span>
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="flex-shrink-0 bg-gradient-to-t from-background via-background to-background/0 px-3 pb-3 pt-2 sm:px-6 sm:pb-4">
            <div className="mx-auto w-full max-w-3xl">
              {aiNotice && (
                <div
                  className={cn(
                    'mb-2 flex items-start gap-2 rounded-xl px-3 py-2 text-xs',
                    aiNotice.kind === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-accent text-primary'
                  )}
                >
                  {aiNotice.kind === 'error' ? (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  ) : (
                    <Crown className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  )}
                  <span className="flex-1">{aiNotice.text}</span>
                  <button onClick={() => setAiNotice(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-foreground/10">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitComposer();
                }}
                className="rounded-2xl border border-border bg-card shadow-lg shadow-black/5 transition-shadow focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10"
              >
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                    {attachments.map((a) => (
                      <span
                        key={a.id}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]',
                          a.status === 'failed'
                            ? 'border-destructive/40 bg-destructive/10 text-destructive'
                            : 'border-border bg-background text-foreground'
                        )}
                      >
                        <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                        <span className="max-w-[140px] truncate">{a.name}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.id)}
                          className="rounded p-0.5 hover:bg-foreground/10"
                          aria-label={`Remove ${a.name} from this session`}
                          title="Remove from session"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    const el = e.target;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submitComposer();
                    }
                  }}
                  placeholder={
                    limitReached
                      ? 'No AI credits left this month'
                      : selectedMode === 'chat'
                        ? 'Ask anything about this task…'
                        : `Message · ${modeLabel(selectedMode)}`
                  }
                  disabled={loading || limitReached}
                  aria-label="Message the study assistant"
                  className="block max-h-[180px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                />

                <div className="flex items-center gap-1.5 px-2 pb-2">
                  <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Upload document"
                    title="Upload document"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>

                  <ChipSelect
                    label="Who you’re talking to"
                    value={persona}
                    onChange={(v) => choosePersona(v as AiPersona)}
                    options={personaOptions.map((p) => ({ value: p.id, label: `${p.emoji} ${p.label}` }))}
                  />
                  <ChipSelect
                    label="Study mode for the next message"
                    value={selectedMode}
                    disabled={loading}
                    onChange={(v) => setSelectedMode(v as StudyMode)}
                    options={MODE_SELECT_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
                    className="hidden sm:inline-flex"
                  />
                  <ChipSelect
                    label="AI model"
                    value={selectedAi}
                    onChange={(v) => chooseAi(v as AiOptionId)}
                    options={AI_OPTIONS.map((o) => ({
                      value: o.id,
                      label: `${o.id === 'study-bot' ? '👑' : '✨'} ${o.label}${o.premiumOnly && !isPro ? ' (Premium)' : ''}`,
                    }))}
                    className="hidden md:inline-flex"
                  />

                  <span className="flex-1" />
                  {nearLimit && (
                    <span className={cn('text-[10px] tabular-nums', overLimit ? 'text-destructive' : 'text-muted-foreground')}>
                      {input.length}/{maxChars}
                    </span>
                  )}
                  <button
                    type="submit"
                    disabled={loading || !input.trim() || limitReached || overLimit}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="Send message"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : limitReached ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </form>
              <p className="mt-1.5 hidden text-center text-[11px] text-muted-foreground sm:block">
                Enter to send · Shift + Enter for a new line · AI can make mistakes, so check important facts.
              </p>
            </div>
          </div>
        </section>
      </div>

      {docDialogOpen && (
        <LiveDocDialog
          status={docStatus}
          busy={docBusy}
          error={docError}
          hasMessages={messages.length > 0}
          onClose={() => setDocDialogOpen(false)}
          onConnect={connectDocs}
          onCreate={createDoc}
          onUpdate={() => void refreshDoc()}
          onToggleAuto={toggleDocAuto}
          onStop={stopDoc}
        />
      )}

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          isPro={isPro}
          onAttached={(chip) => setAttachments((prev) => [...prev, chip])}
        />
      )}
    </div>
    </VideoPlayerProvider>
  );

  return portalReady ? createPortal(workspace, document.body) : workspace;
}

/** Set up and manage the session's live Google Doc. */
function LiveDocDialog({
  status,
  busy,
  error,
  hasMessages,
  onClose,
  onConnect,
  onCreate,
  onUpdate,
  onToggleAuto,
  onStop,
}: {
  status: LiveDocStatus | null;
  busy: 'idle' | 'connecting' | 'creating' | 'updating';
  error: string | null;
  hasMessages: boolean;
  onClose: () => void;
  onConnect: () => void;
  onCreate: () => void;
  onUpdate: () => void;
  onToggleAuto: (on: boolean) => void;
  onStop: () => void;
}) {
  const doc = status?.doc ?? null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Live Google Doc"
        className="w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-2xl animate-fade-in sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-foreground">Live Google Doc</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              TaskTrack writes your study notes into a Google Doc and keeps editing it as you chat.
              Ask things like &ldquo;add a section on causes&rdquo; or &ldquo;make it shorter&rdquo;.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="tap-target rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!status ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !status.connected ? (
          <div className="mt-5 space-y-3">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-sky-600" /> TaskTrack can only open the docs it creates, never the rest of your Drive.</li>
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-sky-600" /> Anything you type in the doc yourself is kept.</li>
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-sky-600" /> Each update uses 1 AI credit.</li>
            </ul>
            <button
              onClick={onConnect}
              disabled={busy === 'connecting'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:opacity-60"
            >
              {busy === 'connecting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {status.needsReconnect ? 'Reconnect Google' : 'Connect Google Docs'}
            </button>
            <p className="text-center text-[11px] text-muted-foreground">You&rsquo;ll come straight back to this session.</p>
          </div>
        ) : !doc ? (
          <div className="mt-5 space-y-3">
            <p className="text-xs text-muted-foreground">
              Connected{status.email ? ` as ${status.email}` : ''}. Create a doc for this session
              {hasMessages ? ' and TaskTrack will fill it with what you have covered so far.' : '.'}
            </p>
            <button
              onClick={onCreate}
              disabled={busy === 'creating'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:opacity-60"
            >
              {busy === 'creating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {busy === 'creating' ? 'Creating your doc…' : 'Create live doc'}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-sky-400"
            >
              <FileText className="h-5 w-5 flex-shrink-0 text-sky-600" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{doc.title}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {doc.lastWrittenAt ? `Last updated ${format(new Date(doc.lastWrittenAt), 'd MMM, h:mm a')}` : 'Not written yet'}
                </span>
              </span>
              <ExternalLink className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </a>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span>
                <span className="block text-sm font-medium text-foreground">Update as I chat</span>
                <span className="block text-[11px] text-muted-foreground">After every reply. 1 AI credit each time.</span>
              </span>
              <input
                type="checkbox"
                checked={doc.autoUpdate}
                onChange={(e) => onToggleAuto(e.target.checked)}
                className="h-5 w-5 accent-sky-600"
              />
            </label>

            <div className="flex gap-2">
              <button
                onClick={onUpdate}
                disabled={busy === 'updating' || !hasMessages}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:opacity-60"
              >
                {busy === 'updating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {busy === 'updating' ? 'Updating…' : 'Update now'}
              </button>
              <button
                onClick={onStop}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Stop
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              For graded essays and coursework the doc holds your outline, evidence and feedback, not
              a finished piece to hand in. Stopping keeps the doc in your Google Drive.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The small round TaskTrack AI mark shown beside each assistant reply. */
function AssistantAvatar() {
  return (
    <div
      aria-hidden
      className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm"
    >
      <Sparkles className="h-4 w-4" />
    </div>
  );
}

/** A native select dressed as a compact pill, for the composer's settings. */
function ChipSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex min-w-0 items-center', className)}>
      <select
        aria-label={label}
        title={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-[150px] cursor-pointer appearance-none truncate rounded-lg border border-border bg-background py-0 pl-2.5 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
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
        {message.mode === 'speed' && (
          <QuizView data={message.structured as QuizData} onFinish={onQuizFinished} timeLimitSec={60} />
        )}
        {message.mode === 'flashcards' && (
          <FlashcardsView
            data={message.structured as FlashcardsData}
            deckDefaults={deckDefaults}
          />
        )}
        {message.mode === 'plan' && <PlanView data={message.structured as StudyPlanData} onPractice={onPractice} />}
        {message.mode === 'slides' && <SlidesView data={message.structured as SlidesData} />}
        {message.mode === 'videos' && <VideosView data={message.structured as VideosData} />}
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
