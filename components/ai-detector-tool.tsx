'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ScanSearch, Loader2, Lock, Sparkles, Info } from 'lucide-react';
import { countWords, detectAi, type DetectResult, type ToolAccess } from '@/lib/tool-unlocks';

const MAX_WORDS = 1000;

const BANDS: Record<DetectResult['band'], { label: string; color: string; bar: string }> = {
  likely_ai: { label: 'Likely AI-generated', color: 'text-red-600', bar: 'bg-red-500' },
  mixed: { label: 'Mixed / unclear', color: 'text-amber-600', bar: 'bg-amber-500' },
  likely_human: { label: 'Likely human-written', color: 'text-emerald-600', bar: 'bg-emerald-500' },
};

function sentenceStyle(ai: number | null) {
  if (ai == null) return '';
  if (ai >= 70) return 'bg-red-100 dark:bg-red-950/40';
  if (ai >= 40) return 'bg-amber-100 dark:bg-amber-950/40';
  return '';
}

export function AiDetectorTool({ access, onUsed }: { access: ToolAccess; onUsed: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectResult | null>(null);

  const words = countWords(text);
  const left = Math.max(access.detectorLimit - access.detectorUsed, 0);
  const over = words > MAX_WORDS;

  if (!access.premium) {
    return (
      <div className="max-w-lg mx-auto py-8 text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center">
          <Lock className="w-6 h-6 text-blue-600" />
        </div>
        <h2 className="text-xl font-bold">You found the AI Detector</h2>
        <p className="text-sm text-muted-foreground">
          Your code worked, and the tool is saved to your account. It runs for Premium students, so upgrade to start checking.
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
    const res = await detectAi(text);
    setBusy(false);
    if (res.ok) setResult(res.result);
    else setError(res.error);
    onUsed();
  };

  const band = result ? BANDS[result.band] : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ScanSearch className="w-5 h-5 text-indigo-500" /> AI Detector
          </h2>
          <p className="text-sm text-muted-foreground">
            Paste some text to estimate how likely it is to be AI-generated, sentence by sentence.
          </p>
        </div>
        <span className={cn(
          'text-xs font-semibold px-3 py-1 rounded-full',
          left > 0 ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'bg-muted text-muted-foreground',
        )}>
          {left} of {access.detectorLimit} checks left today
        </span>
      </div>

      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setResult(null); }}
          placeholder="Paste at least 40 words (up to 1000)…"
          aria-label="Text to check"
          className="w-full min-h-[220px] rounded-xl border border-input bg-background p-4 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/40 resize-y"
        />
        <div className="flex items-center justify-between gap-3">
          <span className={cn('text-xs tabular-nums', over ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
            {words} / {MAX_WORDS} words
          </span>
          <Button onClick={run} disabled={busy || words < 40 || over || left === 0}>
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking…</> : <><ScanSearch className="w-4 h-4 mr-2" />Check</>}
          </Button>
        </div>
        {left === 0 && <p className="text-xs text-muted-foreground">You’ve used today’s 5 checks. They reset at midnight UTC.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {result && band && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className={cn('text-lg font-bold', band.color)}>{band.label}</p>
              <p className="text-3xl font-bold tabular-nums">{result.score}%<span className="text-sm font-medium text-muted-foreground ml-1">AI likelihood</span></p>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', band.bar)} style={{ width: `${result.score}%` }} />
            </div>
            {result.reasons.length > 0 && (
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {[
                ['Words', result.stats.words],
                ['Sentences', result.stats.sentences],
                ['Avg sentence', `${result.stats.avgSentenceLength} words`],
                ['Rhythm variety', result.stats.sentenceVariation],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">{k}</p>
                  <p className="text-sm font-semibold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border p-5 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-semibold">Sentence by sentence</p>
              <div className="flex gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 dark:bg-red-950/40" />Reads like AI</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-950/40" />Unclear</span>
              </div>
            </div>
            <p className="text-sm leading-relaxed">
              {result.sentences.map((s, i) => (
                <span key={i} title={s.ai != null ? `${s.ai}% AI-like` : undefined} className={cn('rounded px-0.5', sentenceStyle(s.ai))}>
                  {s.text}{' '}
                </span>
              ))}
            </p>
          </div>
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        This is an estimate, not proof. No AI detector (including this one) is fully reliable: real human writing sometimes gets flagged, and AI text sometimes doesn’t. Don’t use it alone to accuse anyone.
      </p>
    </div>
  );
}
