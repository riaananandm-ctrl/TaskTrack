'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Wand2, Copy, Check, Loader2, Lightbulb, Sparkles, Lock } from 'lucide-react';
import { countWords, polishWriting, type PolishFocus, type PolishResult, type ToolAccess } from '@/lib/tool-unlocks';

const MAX_WORDS = 500;
const DRAFT_KEY = 'tasktrack.polish.draft';

const FOCUSES: { id: PolishFocus; label: string; hint: string }[] = [
  { id: 'clarity', label: 'Clearer', hint: 'Easier to follow' },
  { id: 'grammar', label: 'Grammar only', hint: 'Fix mistakes, change little else' },
  { id: 'academic', label: 'More academic', hint: 'Formal tone for assessed work' },
  { id: 'concise', label: 'Shorter', hint: 'Cut repetition' },
];

export function PolishWritingTool({ access, onUsed }: { access: ToolAccess; onUsed: () => void }) {
  const [text, setText] = useState('');
  const [focus, setFocus] = useState<PolishFocus>('clarity');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PolishResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try { setText(window.localStorage.getItem(DRAFT_KEY) ?? ''); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(DRAFT_KEY, text); } catch { /* ignore */ }
  }, [text]);

  const words = countWords(text);
  const left = Math.max(access.polishLimit - access.polishUsed, 0);
  const over = words > MAX_WORDS;

  if (!access.premium) {
    return (
      <div className="max-w-lg mx-auto py-8 text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center">
          <Lock className="w-6 h-6 text-blue-600" />
        </div>
        <h2 className="text-xl font-bold">You found Polish my writing</h2>
        <p className="text-sm text-muted-foreground">
          Your code worked, and the tool is saved to your account. It runs for Premium students, so upgrade to start polishing.
        </p>
        <Link href="/app/premium" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <Sparkles className="w-4 h-4" /> Upgrade to Premium
        </Link>
      </div>
    );
  }

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await polishWriting(text, focus);
    setBusy(false);
    if (res.ok) {
      setResult(res.result);
      setCopied(false);
    } else {
      setError(res.error);
    }
    onUsed();
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.polished);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-fuchsia-500" /> Polish my writing
          </h2>
          <p className="text-sm text-muted-foreground">
            Paste your own draft. It fixes clarity, grammar and flow but keeps your ideas and voice, and shows you what changed and why.
          </p>
        </div>
        <span className={cn(
          'text-xs font-semibold px-3 py-1 rounded-full',
          left > 0 ? 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300' : 'bg-muted text-muted-foreground',
        )}>
          {left} of {access.polishLimit} polishes left today
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {FOCUSES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFocus(f.id)}
            title={f.hint}
            className={cn(
              'px-3 py-1.5 rounded-full border text-sm transition-colors',
              focus === f.id ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border hover:bg-muted/50',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your draft</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a paragraph or two of your own writing (up to 500 words)…"
            aria-label="Your draft"
            className="w-full min-h-[280px] rounded-xl border border-input bg-background p-4 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/40 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <span className={cn('text-xs tabular-nums', over ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
              {words} / {MAX_WORDS} words
            </span>
            <Button onClick={run} disabled={busy || words < 10 || over || left === 0}>
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Polishing…</> : <><Wand2 className="w-4 h-4 mr-2" />Polish</>}
            </Button>
          </div>
          {left === 0 && <p className="text-xs text-muted-foreground">You’ve used today’s 3 polishes. They reset at midnight UTC.</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Polished</p>
            {result && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setText(result.polished)}>Use as draft</Button>
                <Button size="sm" variant="outline" onClick={copy}>
                  {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </div>
          <div className="min-h-[280px] rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {result ? result.polished : <span className="text-muted-foreground">Your polished version shows up here.</span>}
          </div>
        </div>
      </div>

      {result && (result.changes.length > 0 || result.tip) && (
        <div className="rounded-xl border border-border p-4 space-y-3">
          <p className="text-sm font-semibold">What changed and why</p>
          <ul className="space-y-3">
            {result.changes.map((c, i) => (
              <li key={i} className="text-sm space-y-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  {c.before && <span className="line-through text-red-600/80">{c.before}</span>}
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">{c.after}</span>
                </div>
                <p className="text-xs text-muted-foreground">{c.why}</p>
              </li>
            ))}
          </ul>
          {result.tip && (
            <p className="flex items-start gap-2 text-sm rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3">
              <Lightbulb className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" />
              <span><span className="font-semibold">Next time: </span>{result.tip}</span>
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Use this on writing you wrote yourself, and follow your school’s rules on AI help (some assessed work needs you to say you used it).
      </p>
    </div>
  );
}
