'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Gift, Instagram, CheckCircle2, Loader2 } from 'lucide-react';
import { redeemCode } from '@/lib/tool-unlocks';
import { CHRISTMAS_EVENT, CHRISTMAS_TOOL, christmasSwitchedOff, setChristmasOn } from '@/lib/christmas';

const TOOL_NAMES: Record<string, string> = { polish: 'Polish my writing', detector: 'AI Detector' };

export function RedeemCodeTool({ unlocked, onOpenTool }: { unlocked: string[]; onOpenTool: (tool: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ tool: string; already: boolean } | null>(null);
  const [xmasOn, setXmasOn] = useState(true);
  const hasXmas = unlocked.includes(CHRISTMAS_TOOL) || success?.tool === CHRISTMAS_TOOL;

  useEffect(() => {
    setXmasOn(!christmasSwitchedOff());
    const onToggle = (e: Event) => setXmasOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(CHRISTMAS_EVENT, onToggle);
    return () => window.removeEventListener(CHRISTMAS_EVENT, onToggle);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    const res = await redeemCode(code);
    setBusy(false);
    if (res.ok) {
      if (res.tool === CHRISTMAS_TOOL) setChristmasOn(true);
      setSuccess({ tool: res.tool, already: res.already });
      setCode('');
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-4 space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 flex items-center justify-center text-white">
          <Gift className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold">Redeem a code</h2>
        <p className="text-sm text-muted-foreground">
          Secret codes unlock hidden tools. Follow{' '}
          <a href="https://instagram.com/task.track" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
            @task.track
          </a>{' '}
          on Instagram to find them.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
          placeholder="ENTER-CODE"
          aria-label="Redeem code"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          className="flex-1 h-11 rounded-xl border border-input bg-background px-4 font-mono tracking-widest text-center uppercase outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <Button type="submit" className="h-11 px-5" disabled={busy || code.trim().length < 4}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Redeem'}
        </Button>
      </form>

      {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      {success?.tool === CHRISTMAS_TOOL && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-gradient-to-br from-red-50 to-emerald-50 dark:from-red-950/30 dark:to-emerald-950/30 p-4 text-center space-y-1">
          <p className="text-lg font-bold">🎄 Merry Christmas! 🎁</p>
          <p className="text-sm">TaskTrack is dressed up for the holidays. You can switch it off below any time.</p>
        </div>
      )}
      {success && success.tool !== CHRISTMAS_TOOL && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-center space-y-2">
          <p className="flex items-center justify-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
            {success.already ? 'You already have this one' : 'Unlocked!'}
          </p>
          <p className="text-sm">{TOOL_NAMES[success.tool] ?? success.tool} is now in your Tools.</p>
          <Button size="sm" variant="outline" onClick={() => onOpenTool(success.tool)}>Open it</Button>
        </div>
      )}

      <div className="rounded-xl border border-border p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hidden tools</p>
        {Object.entries(TOOL_NAMES).map(([id, name]) => (
          <div key={id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{unlocked.includes(id) ? name : '??? Secret tool'}</p>
              <p className="text-xs text-muted-foreground">
                {unlocked.includes(id) ? 'Unlocked · Premium' : 'Find the code on Instagram'}
              </p>
            </div>
            {unlocked.includes(id) ? (
              <Button size="sm" variant="ghost" onClick={() => onOpenTool(id)}>Open</Button>
            ) : (
              <a href="https://instagram.com/task.track" target="_blank" rel="noopener noreferrer" aria-label="Open @task.track on Instagram">
                <Instagram className="w-5 h-5 text-muted-foreground hover:text-primary" />
              </a>
            )}
          </div>
        ))}
        {hasXmas && (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <div>
              <p className="text-sm font-medium">🎄 Christmas mode</p>
              <p className="text-xs text-muted-foreground">Snow, lights and a tree across the app</p>
            </div>
            <Button
              size="sm"
              variant={xmasOn ? 'default' : 'outline'}
              role="switch"
              aria-checked={xmasOn}
              onClick={() => setChristmasOn(!xmasOn)}
            >
              {xmasOn ? 'On' : 'Off'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
