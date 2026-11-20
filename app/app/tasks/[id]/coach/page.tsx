'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { ArrowLeft, Check, X, Loader2, PenLine, RotateCcw, Save, Trash2, Info, ChevronDown, Lightbulb, ExternalLink } from 'lucide-react';
import {
  COACH_MAX_WORDS,
  COACH_MIN_WORDS,
  applySuggestions,
  countWords,
  deleteDraft,
  getCoachAccess,
  loadDraft,
  requestSuggestions,
  saveDraft,
  segments,
  type CoachGoal,
  type CoachSuggestion,
  type CoachTone,
  type TaskDraft,
} from '@/lib/rewrite-coach';

const GOALS: { id: CoachGoal; label: string }[] = [
  { id: 'clarity', label: 'Make it clearer' },
  { id: 'concise', label: 'More concise' },
  { id: 'grammar', label: 'Improve grammar' },
  { id: 'structure', label: 'Improve structure' },
  { id: 'tone', label: 'Change tone' },
];
const TONES: { id: CoachTone; label: string }[] = [
  { id: 'simple', label: 'Simple' },
  { id: 'confident', label: 'Confident' },
  { id: 'formal', label: 'Formal' },
  { id: 'friendly', label: 'Friendly' },
];
const TYPE_LABELS: Record<string, string> = {
  clarity: 'Clarity', concision: 'Concision', grammar: 'Grammar', structure: 'Structure', tone: 'Tone', word_choice: 'Word choice',
};

type Decision = 'accepted' | 'rejected';

const OTHER_WRITING_TOOLS = [
  { name: 'Grammarly', url: 'https://www.grammarly.com', what: 'Spelling, grammar and punctuation as you type. Free plan.' },
  { name: 'Hemingway Editor', url: 'https://hemingwayapp.com', what: 'Highlights long, hard-to-read sentences. Free in the browser.' },
  { name: 'QuillBot Grammar Checker', url: 'https://quillbot.com/grammar-check', what: 'Quick grammar and spelling check. Free.' },
  { name: 'LanguageTool', url: 'https://languagetool.org', what: 'Grammar checking in English, Spanish, French, German and more. Free plan.' },
  { name: 'Purdue OWL', url: 'https://owl.purdue.edu/owl/purdue_owl.html', what: 'Clear guides on essay structure, grammar and referencing. Free.' },
  { name: 'Scribbr Citation Generator', url: 'https://www.scribbr.com/citation/generator/', what: 'Builds MLA and APA references for your sources. Free.' },
];

export default function RewriteCoachPage({ params }: { params: { id: string } }) {
  const taskId = params.id;
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [access, setAccess] = useState<{ used: number; limit: number; premium: boolean; plan: string | null }>({ used: 0, limit: 0, premium: false, plan: null });

  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [goal, setGoal] = useState<CoachGoal>('clarity');
  const [tone, setTone] = useState<CoachTone>('confident');

  // The text the current suggestions were made against, and the first such text
  // this visit (used as the stored original when there is no saved draft yet).
  const [base, setBase] = useState<string | null>(null);
  const [sessionOriginal, setSessionOriginal] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CoachSuggestion[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const refreshAccess = useCallback(() => { getCoachAccess().then(setAccess); }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: task }, saved] = await Promise.all([
        supabase.from('tasks').select('id, title').eq('id', taskId).maybeSingle(),
        loadDraft(taskId),
        getCoachAccess().then((a) => { if (!cancelled) setAccess(a); }),
      ]);
      if (cancelled) return;
      if (!task) setNotFound(true);
      else setTaskTitle((task as { title: string }).title);
      setDraft(saved);
      if (saved) setText(saved.revised_text);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, taskId]);

  const words = countWords(text);
  const left = Math.max(access.limit - access.used, 0);
  const accepted = useMemo(
    () => new Set(Object.entries(decisions).filter(([, d]) => d === 'accepted').map(([id]) => id)),
    [decisions],
  );
  const revised = useMemo(() => (base == null ? '' : applySuggestions(base, suggestions, accepted)), [base, suggestions, accepted]);
  const pending = suggestions.filter((s) => !decisions[s.id]).length;
  const reviewing = base != null;

  const canRun = confirmed && !busy && words >= COACH_MIN_WORDS && words <= COACH_MAX_WORDS && left > 0 && (goal !== 'tone' || !!tone);

  const run = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await requestSuggestions({ taskId, text, goal, tone: goal === 'tone' ? tone : undefined });
    setBusy(false);
    refreshAccess();
    if (!res.ok) { setError(res.error); return; }
    if (res.suggestions.length === 0) {
      setMessage('No changes suggested for that goal. Try a different goal, or your draft may already be in good shape.');
      setNotes(res.notes);
      return;
    }
    setBase(text);
    if (sessionOriginal == null) setSessionOriginal(text);
    setSuggestions(res.suggestions);
    setNotes(res.notes);
    setDecisions({});
  };

  const decide = (id: string, d: Decision) =>
    setDecisions((prev) => {
      const next = { ...prev };
      if (next[id] === d) delete next[id];
      else next[id] = d;
      return next;
    });
  const decideAll = (d: Decision) => setDecisions(Object.fromEntries(suggestions.map((s) => [s.id, d])));

  const stopReviewing = (nextText: string) => {
    setText(nextText);
    setBase(null);
    setSuggestions([]);
    setNotes([]);
    setDecisions({});
  };

  const save = async () => {
    if (base == null) return;
    setSaving(true);
    setError(null);
    const original = draft ? draft.original_text : (sessionOriginal ?? base);
    const saved = await saveDraft(taskId, draft, original, revised);
    setSaving(false);
    if (!saved) { setError('Couldn’t save. Please try again.'); return; }
    setDraft(saved);
    stopReviewing(saved.revised_text);
    setMessage('Saved to this task. Your original draft is kept and can be restored at any time.');
  };

  const restoreOriginal = async () => {
    if (!draft) return;
    if (!window.confirm('Replace the saved version with your original draft? Your original stays saved either way.')) return;
    const saved = await saveDraft(taskId, draft, draft.original_text, draft.original_text);
    if (!saved) { setError('Couldn’t restore. Please try again.'); return; }
    setDraft(saved);
    stopReviewing(saved.revised_text);
    setMessage('Restored your original draft.');
  };

  const removeDraft = async () => {
    if (!draft) return;
    if (!window.confirm('Delete the saved draft (original and revised) from this task? This can’t be undone.')) return;
    const ok = await deleteDraft(draft.id);
    if (!ok) { setError('Couldn’t delete. Please try again.'); return; }
    setDraft(null);
    setSessionOriginal(null);
    stopReviewing('');
    setMessage('Draft deleted from this task.');
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  if (notFound) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-3">
        <p className="font-semibold">That task couldn’t be found.</p>
        <Link href="/app/tasks" className="text-sm text-primary hover:underline">Back to tasks</Link>
      </div>
    );
  }

  // Rewrite Coach is part of the Max plan.
  if (access.plan && access.plan !== 'max') {
    return (
      <div className="space-y-6 animate-fade-in max-w-xl">
        <Link href="/app/tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Tasks
        </Link>
        <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center">
          <PenLine className="mx-auto h-8 w-8 text-primary" />
          <h1 className="mt-3 text-xl font-bold">Rewrite Coach is part of Max</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Get suggested edits to your own draft for clarity, grammar, structure and tone, and keep only the ones you
            agree with. Max is ₹999 for 3 months and includes 1,000 AI credits a month, everything in Premium, and 50
            Rewrite Coach runs a day.
          </p>
          <Button asChild className="mt-5">
            <Link href="/app/premium?plan=max">Upgrade to Max</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      <div className="space-y-2">
        <Link href="/app/tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Tasks
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <PenLine className="w-6 h-6 text-primary" /> Rewrite Coach
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              For <span className="font-medium text-foreground">{taskTitle}</span>. Get suggested edits to your own draft, then keep the ones you agree with.
            </p>
          </div>
          <span className={cn('text-xs font-semibold px-3 py-1 rounded-full', left > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
            {left} of {access.limit} runs left today
          </span>
        </div>
      </div>

      <section className="rounded-xl border border-border p-4 space-y-3" aria-labelledby="other-tools-heading">
        <div>
          <h2 id="other-tools-heading" className="text-sm font-semibold">Want a second opinion? These tools are great too</h2>
          <p className="text-xs text-muted-foreground">They all have a free version and help you improve writing that’s yours.</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {OTHER_WRITING_TOOLS.map((t) => (
            <li key={t.name}>
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="group flex h-full flex-col rounded-lg border border-border bg-card px-3 py-2 hover:border-primary/40 hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-1.5 text-sm font-medium">{t.name}<ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" aria-hidden /></span>
                <span className="text-xs text-muted-foreground">{t.what}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {draft && (
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-semibold">Saved draft</span>
              <span className="text-muted-foreground"> · last saved {new Date(draft.updated_at).toLocaleString()}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowOriginal((v) => !v)}>
                <ChevronDown className={cn('w-4 h-4 mr-1 transition-transform', showOriginal && 'rotate-180')} />
                {showOriginal ? 'Hide original' : 'View original'}
              </Button>
              <Button size="sm" variant="outline" onClick={restoreOriginal} disabled={draft.original_text === draft.revised_text}>
                <RotateCcw className="w-4 h-4 mr-1" /> Restore original
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={removeDraft}>
                <Trash2 className="w-4 h-4 mr-1" /> Delete draft
              </Button>
            </div>
          </div>
          {showOriginal && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap max-h-72 overflow-auto">{draft.original_text}</div>
          )}
        </div>
      )}

      {!reviewing && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="coach-draft" className="text-sm font-semibold">Your draft</label>
            <textarea
              id="coach-draft"
              value={text}
              onChange={(e) => { setText(e.target.value); setMessage(null); }}
              placeholder={`Paste a draft you wrote (${COACH_MIN_WORDS}–${COACH_MAX_WORDS} words)…`}
              className="w-full min-h-[240px] rounded-xl border border-input bg-background p-4 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/40 resize-y"
            />
            <p className={cn('text-xs tabular-nums', words > COACH_MAX_WORDS ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
              {words} / {COACH_MAX_WORDS} words
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Goal</p>
            <div className="flex flex-wrap gap-2">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGoal(g.id)}
                  aria-pressed={goal === g.id}
                  className={cn('px-3 py-1.5 rounded-full text-sm border transition-colors',
                    goal === g.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent')}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {goal === 'tone' && (
              <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="Tone">
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id)}
                    aria-pressed={tone === t.id}
                    className={cn('px-3 py-1 rounded-full text-xs border transition-colors',
                      tone === t.id ? 'bg-primary/15 border-primary text-primary font-semibold' : 'border-border hover:bg-accent')}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-border p-3 cursor-pointer">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" aria-label="I wrote this text or have permission to edit it" />
            <span className="text-sm">I wrote this text myself, or I have permission to edit it.</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} disabled={!canRun}>
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Reading your draft…</> : 'Get suggestions'}
            </Button>
            {!confirmed && words >= COACH_MIN_WORDS && <span className="text-xs text-muted-foreground">Tick the box above to continue.</span>}
            {left === 0 && <span className="text-xs text-muted-foreground">You’ve used today’s runs. They reset at midnight UTC.</span>}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}

      {reviewing && base != null && (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border p-4 space-y-2" aria-label="Original">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Original</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {segments(base, suggestions).map((seg, i) => {
                  const s = seg.suggestion;
                  if (!s) return <span key={i}>{seg.text}</span>;
                  const n = suggestions.findIndex((x) => x.id === s.id) + 1;
                  const d = decisions[s.id];
                  return (
                    <a
                      key={i}
                      href={`#coach-${s.id}`}
                      className={cn('rounded px-0.5 no-underline',
                        d === 'accepted' ? 'bg-emerald-100 dark:bg-emerald-950/50' : d === 'rejected' ? 'bg-muted' : 'bg-amber-100 dark:bg-amber-950/40')}
                    >
                      {seg.text}<sup className="ml-0.5 text-[10px] font-bold text-muted-foreground">{n}</sup>
                    </a>
                  );
                })}
              </p>
            </section>
            <section className="rounded-xl border border-primary/40 p-4 space-y-2" aria-label="Revised">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Revised · {accepted.size} accepted</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{revised}</p>
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}
              {pending > 0 && <span className="font-normal text-muted-foreground"> · {pending} to review</span>}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => decideAll('accepted')}>Accept all</Button>
              <Button size="sm" variant="outline" onClick={() => decideAll('rejected')}>Reject all</Button>
              <Button size="sm" variant="ghost" onClick={() => setDecisions({})}>Reset</Button>
            </div>
          </div>

          <ol className="space-y-3">
            {suggestions.map((s, i) => {
              const d = decisions[s.id];
              return (
                <li
                  key={s.id}
                  id={`coach-${s.id}`}
                  className={cn('rounded-xl border p-4 space-y-2 scroll-mt-24',
                    d === 'accepted' ? 'border-emerald-300 dark:border-emerald-800' : d === 'rejected' ? 'border-border opacity-60' : 'border-border')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {i + 1}. {TYPE_LABELS[s.type] ?? 'Edit'}{s.major && <span className="ml-2 rounded bg-primary/10 text-primary px-1.5 py-0.5">Major edit</span>}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant={d === 'accepted' ? 'default' : 'outline'} onClick={() => decide(s.id, 'accepted')} aria-pressed={d === 'accepted'}>
                        <Check className="w-4 h-4 mr-1" /> Accept
                      </Button>
                      <Button size="sm" variant={d === 'rejected' ? 'secondary' : 'outline'} onClick={() => decide(s.id, 'rejected')} aria-pressed={d === 'rejected'}>
                        <X className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm"><span className="line-through decoration-red-400 text-muted-foreground">{s.original}</span></p>
                  <p className="text-sm font-medium">{s.replacement || <em className="text-muted-foreground">(remove)</em>}</p>
                  {s.why && <p className="text-xs text-muted-foreground">{s.why}</p>}
                </li>
              );
            })}
          </ol>

          {notes.length > 0 && (
            <div className="rounded-xl bg-muted/50 p-4 space-y-1">
              <p className="text-sm font-semibold flex items-center gap-1.5"><Lightbulb className="w-4 h-4 text-amber-500" /> Ideas to consider yourself</p>
              <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}

          <div className="sticky bottom-3 z-10 rounded-xl border border-border bg-background/95 backdrop-blur p-3 flex flex-wrap items-center justify-between gap-2 shadow-sm">
            <p className="text-xs text-muted-foreground">Nothing is saved until you choose to save. Your original draft is always kept.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => stopReviewing(base)}>Discard suggestions</Button>
              <Button variant="outline" onClick={() => stopReviewing(revised)} disabled={accepted.size === 0}>Keep editing revised</Button>
              <Button onClick={save} disabled={saving || accepted.size === 0}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save to task
              </Button>
            </div>
          </div>
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        Rewrite Coach suggests edits to writing you’ve already done. It doesn’t write assignments or add facts or sources. You’re responsible for your final work and for following your school’s rules on using AI.
      </p>
    </div>
  );
}
