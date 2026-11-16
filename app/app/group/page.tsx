'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { AlertCircle, ArrowLeft, Check, Copy, Crown, Flag, Loader2, LogOut, Send, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { askGroupAi } from '@/lib/ai-tools';
import {
  createGroup,
  endGroup,
  formatCode,
  joinGroup,
  leaveGroup,
  listMyGroups,
  loadRoom,
  sendMessage,
  reportMessage,
  REPORT_REASONS,
  type ReportReason,
  MAX_GROUP_MEMBERS,
  MAX_MESSAGE_CHARS,
  type GroupMember,
  type GroupMessage,
  type StudyGroup,
} from '@/lib/group-study';
import { GroupIcon } from '@/components/brand-icons';
import { ParentConsentCard } from '@/components/consent-gate';
import { needsParent, useConsent } from '@/lib/consent';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export default function GroupStudyPage() {
  const searchParams = useSearchParams();
  const groupId = searchParams.get('g');
  return groupId ? <Room key={groupId} groupId={groupId} /> : <Lobby />;
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------- Lobby

function Lobby() {
  const router = useRouter();
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyGroups().then(({ groups: g, error }) => {
      if (cancelled) return;
      setGroups(g);
      setListError(error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = (id: string) => router.push(`/app/group?g=${id}`);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    const res = await createGroup(name.trim(), topic.trim());
    if (res.ok) open(res.id);
    else {
      setCreateError(res.error);
      setCreating(false);
    }
  };

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 6 || joining) return;
    setJoining(true);
    setJoinError(null);
    const res = await joinGroup(code);
    if (res.ok) open(res.id);
    else {
      setJoinError(res.error);
      setJoining(false);
    }
  };

  const active = groups.filter((g) => !g.ended_at);
  const ended = groups.filter((g) => g.ended_at).slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-start gap-4">
        <GroupIcon size={48} />
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Group Study</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Host a private study room, share the code, and work through a topic together. Anyone in the room can ask the AI to help the whole group.
          </p>
        </div>
      </div>

      {listError && <ErrorNote>{listError}</ErrorNote>}

      <GroupSafety />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Host a group</h2>
              <p className="text-sm text-muted-foreground">You get a code to share. Up to {MAX_GROUP_MEMBERS} people.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-name">Group name</Label>
              <Input id="group-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maths: logarithms revision" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-topic">What are you studying? <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="group-topic" value={topic} maxLength={300} rows={2} onChange={(e) => setTopic(e.target.value)} placeholder="The AI uses this to stay on topic." />
            </div>
            {createError && <ErrorNote>{createError}</ErrorNote>}
            <Button type="submit" size="lg" className="w-full" disabled={!name.trim() || creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
              Start group study
            </Button>
          </form>
        </Card>

        <Card className="p-5 sm:p-6">
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Join with a code</h2>
              <p className="text-sm text-muted-foreground">Ask your host for the 6-character code.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-code">Group code</Label>
              <Input
                id="group-code"
                value={code}
                onChange={(e) => setCode(formatCode(e.target.value))}
                placeholder="ABC-123"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="h-14 text-center font-mono text-2xl font-semibold tracking-[0.3em] uppercase placeholder:tracking-[0.3em]"
              />
            </div>
            {joinError && <ErrorNote>{joinError}</ErrorNote>}
            <Button type="submit" size="lg" variant="outline" className="w-full" disabled={code.replace(/[^A-Za-z0-9]/g, '').length < 6 || joining}>
              {joining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Join group
            </Button>
            <p className="text-xs text-muted-foreground">Others in the room see your first name only.</p>
          </form>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your groups</h2>
        {loading ? (
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        ) : active.length === 0 && ended.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No groups yet. Host one above, or join with a code.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[...active, ...ended].map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => open(g.id)}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{g.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{g.topic || 'No topic set'}</span>
                </span>
                <span
                  className={cn(
                    'flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                    g.ended_at ? 'bg-muted text-muted-foreground' : 'bg-[#22B29E]/15 text-[#17806F] dark:text-[#5FD3C0]'
                  )}
                >
                  {g.ended_at ? 'Ended' : 'Active'}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Room

function Room({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [group, setGroup] = useState<StudyGroup | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const refresh = useCallback(async () => {
    const room = await loadRoom(groupId);
    setGroup(room.group);
    setMembers(room.members);
    setMessages(room.messages);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    if (!user) return;
    refresh();
    // Live updates, with a slow poll as a safety net if the live connection drops.
    const channel = supabase
      .channel(`study-group-${groupId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'study_group_messages', filter: `group_id=eq.${groupId}` }, (payload) => {
        const incoming = payload.new as GroupMessage;
        setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_group_members', filter: `group_id=eq.${groupId}` }, () => {
        refresh();
      })
      .subscribe();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 6000);
    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [user, groupId, refresh]);

  // Keep the newest message in view unless the student scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, asking]);

  const me = useMemo(() => members.find((m) => m.user_id === user?.id) ?? null, [members, user]);
  const isHost = !!group && group.host_id === user?.id;
  const ended = !!group?.ended_at;

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !user || !me || sending || ended) return false;
    setSending(true);
    setError(null);
    stickToBottom.current = true;
    const ok = await sendMessage(groupId, user.id, me.display_name, content);
    if (ok) {
      setDraft('');
      await refresh();
    } else {
      setError('Your message didn’t send. Please try again.');
    }
    setSending(false);
    return ok;
  };

  const handleAskAi = async () => {
    if (asking || ended) return;
    setError(null);
    if (draft.trim()) {
      const sent = await handleSend();
      if (!sent) return;
    }
    setAsking(true);
    stickToBottom.current = true;
    const res = await askGroupAi(groupId);
    if (!res.ok) setError(res.error);
    await refresh();
    setAsking(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const copyCode = async () => {
    if (!group) return;
    try {
      await navigator.clipboard.writeText(formatCode(group.join_code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the code is still visible to read out.
    }
  };

  const handleLeave = async () => {
    if (!user) return;
    if (isHost && !ended) {
      if (!window.confirm('End this group study for everyone? The chat stays readable, but no one can send new messages.')) return;
      await endGroup(groupId);
      await refresh();
      return;
    }
    if (!window.confirm('Leave this group? You can rejoin with the code while it is active.')) return;
    await leaveGroup(groupId, user.id);
    router.push('/app/group');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Opening group…
      </div>
    );
  }

  if (!group) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-xl font-semibold">Group not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">This group doesn&rsquo;t exist, or you&rsquo;re not a member. Join with the code from your host.</p>
        <Button className="mt-5" onClick={() => router.push('/app/group')}>
          Back to Group Study
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[28rem] flex-col gap-3 animate-fade-in lg:h-[calc(100dvh-6rem)]">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/app/group')}
          aria-label="Back to Group Study"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight">{group.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{group.topic || 'Private group study'}</p>
        </div>
        {!ended && (
          <button
            type="button"
            onClick={copyCode}
            title="Copy group code"
            className="flex items-center gap-2 rounded-lg border border-dashed border-[#22B29E]/60 bg-[#22B29E]/10 px-3 py-1.5 font-mono text-sm font-semibold tracking-widest text-[#17806F] hover:bg-[#22B29E]/15 dark:text-[#5FD3C0]"
          >
            {formatCode(group.join_code)}
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
        <Button variant="outline" size="sm" onClick={handleLeave} disabled={isHost && ended}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          {isHost ? (ended ? 'Ended' : 'End for all') : 'Leave'}
        </Button>
      </div>

      {/* Members */}
      <div className="flex flex-wrap items-center gap-1.5">
        {members.map((m) => (
          <span key={m.user_id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
            {m.user_id === group.host_id && <Crown className="h-3 w-3 text-amber-500" />}
            {m.display_name}
            {m.user_id === user?.id && <span className="text-muted-foreground">(you)</span>}
          </span>
        ))}
        <span className="text-xs text-muted-foreground">
          {members.length}/{MAX_GROUP_MEMBERS}
        </span>
      </div>

      {/* Messages */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="flex-1 space-y-3 overflow-y-auto p-4"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <GroupIcon size={44} />
              <p className="mt-3 font-semibold">The room is open</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Share the code <strong className="font-mono">{formatCode(group.join_code)}</strong> with your friends, then start with a question.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} mine={m.user_id === user?.id && m.kind === 'user'} />
          ))}
          {asking && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 animate-pulse text-[#22B29E]" /> TaskTrack AI is thinking…
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-3">
          {error && <div className="mb-2"><ErrorNote>{error}</ErrorNote></div>}
          {ended ? (
            <p className="py-2 text-center text-sm text-muted-foreground">This group study has ended. The chat is read-only.</p>
          ) : (
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Message the group…"
                aria-label="Message the group"
                className="max-h-32 min-h-[2.75rem] flex-1 resize-none"
              />
              <Button type="button" variant="outline" onClick={handleAskAi} disabled={asking || sending || (messages.length === 0 && !draft.trim())} title="Ask the AI to answer the latest question. Uses 1 AI credit.">
                {asking ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" /> : <Sparkles className="h-4 w-4 sm:mr-1.5" />}
                <span className="hidden sm:inline">Ask AI</span>
              </Button>
              <Button type="button" onClick={() => void handleSend()} disabled={!draft.trim() || sending} aria-label="Send message">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/** Safety notes for the lobby, plus the parent link for students under 18. */
function GroupSafety() {
  const { consent } = useConsent();
  if (needsParent(consent)) return <ParentConsentCard />;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#22B29E]" />
      <p>
        Be kind. Swear words are filtered automatically, and you can report any message with the flag icon. Only share
        codes with people you know.
      </p>
    </div>
  );
}

function ReportButton({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (reason: ReportReason) => {
    setBusy(true);
    setError(null);
    const problem = await reportMessage(messageId, reason);
    if (problem) setError(problem);
    else {
      setSent(true);
      setOpen(false);
    }
    setBusy(false);
  };

  if (sent) return <span className="text-[11px] text-muted-foreground">Reported. Thanks.</span>;
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-destructive"
        aria-label="Report this message"
        title="Report this message"
      >
        <Flag className="h-3 w-3" />
      </button>
      {open && (
        <span className="absolute left-0 top-5 z-20 flex w-52 flex-col rounded-xl border border-border bg-popover p-1.5 shadow-lg">
          <span className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">Why are you reporting this?</span>
          {REPORT_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              disabled={busy}
              onClick={() => send(r.value)}
              className="rounded-lg px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
          {error && <span className="px-2 py-1 text-[11px] text-destructive">{error}</span>}
        </span>
      )}
    </span>
  );
}

function MessageRow({ message, mine }: { message: GroupMessage; mine: boolean }) {
  if (message.kind === 'system') {
    return <p className="text-center text-xs text-muted-foreground">{message.content}</p>;
  }
  const time = format(parseISO(message.created_at), 'h:mm a');
  const isAi = message.kind === 'ai';
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <span className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        {isAi && <Sparkles className="h-3 w-3 text-[#22B29E]" />}
        <span className={cn('font-semibold', isAi && 'text-[#17806F] dark:text-[#5FD3C0]')}>{mine ? 'You' : message.display_name}</span>
        <span>{time}</span>
        {!mine && <ReportButton messageId={message.id} />}
      </span>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[70%]',
          mine && 'rounded-br-md bg-[#315EDB] text-white',
          !mine && !isAi && 'rounded-bl-md bg-muted',
          isAi && 'rounded-bl-md border border-[#22B29E]/30 bg-[#22B29E]/[0.08]'
        )}
      >
        {isAi ? <MarkdownRenderer content={message.content} /> : <p className="whitespace-pre-wrap break-words">{message.content}</p>}
      </div>
    </div>
  );
}
