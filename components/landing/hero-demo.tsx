'use client';

import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { CalendarCheckIcon } from '@/components/brand-icons';
import { Tilt } from '@/components/fx/tilt';
import { cn } from '@/lib/utils';

/** Synthetic, illustrative tasks for the landing page demo. */
const SAMPLE = [
  { id: 'eng', title: 'English: comparative essay', meta: 'Due in 3 days · Draft outline', colour: 'bg-[#315EDB]', subject: 'English' },
  { id: 'math', title: 'Mathematics: problem set', meta: 'Due Friday · 6 questions', colour: 'bg-amber-500', subject: 'Maths' },
  { id: 'chem', title: 'Chemistry: topic review', meta: 'Study session · 45 min', colour: 'bg-emerald-600', subject: 'Chemistry' },
];

/**
 * The landing page's example workspace, made interactive: visitors can tick tasks off
 * and see the XP and progress respond, the same way the real app does.
 */
export function HeroDemo() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [pops, setPops] = useState<{ id: number; task: string }[]>([]);
  const count = Object.values(done).filter(Boolean).length;
  const pct = Math.round((count / SAMPLE.length) * 100);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (next[id]) {
        const key = Date.now();
        setPops((p) => [...p, { id: key, task: id }]);
        setTimeout(() => setPops((p) => p.filter((x) => x.id !== key)), 900);
      }
      return next;
    });
  };

  return (
    <Tilt className="rounded-2xl" max={5}>
      <div className="rounded-2xl border border-white/60 bg-[#FDFCF9] p-4 shadow-2xl shadow-[#0b1530]/40 ring-1 ring-white/10 sm:p-5" aria-label="Example TaskTrack workspace">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Try it · example workspace</p>
            <p className="mt-1 text-lg font-semibold text-[#243B64]">This week at a glance</p>
          </div>
          <CalendarCheckIcon size={34} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] text-slate-500">Deadlines</p>
            <p className="mt-1 text-2xl font-semibold text-[#243B64]">4</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] text-slate-500">Left to do</p>
            <p className="mt-1 text-2xl font-semibold text-[#243B64] tabular-nums">{SAMPLE.length - count}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] text-slate-500">XP earned</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-600 tabular-nums">{count * 20}</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-[#243B64]">Next up</p>
            <span className="text-xs text-slate-400">{count === SAMPLE.length ? 'All done!' : 'Tap to tick off'}</span>
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-[#315EDB] via-[#22B29E] to-[#62CC6A] transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <div className="space-y-1">
            {SAMPLE.map((t) => {
              const isDone = !!done[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  aria-pressed={isDone}
                  className="group relative flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315EDB]/40"
                >
                  <span className={cn('h-8 w-1 rounded-full transition-opacity', t.colour, isDone && 'opacity-30')} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm font-medium transition-colors', isDone ? 'text-slate-400 line-through' : 'text-slate-700')}>{t.title}</span>
                    <span className="block text-xs text-slate-500">{t.meta}</span>
                  </span>
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-300',
                      isDone ? 'scale-110 border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent group-hover:border-[#315EDB]',
                    )}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  {pops.filter((p) => p.task === t.id).map((p) => (
                    <span key={p.id} className="animate-xp-pop pointer-events-none absolute right-9 top-1 text-xs font-bold text-emerald-600" aria-hidden>
                      +20 XP
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
          {count === SAMPLE.length && (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 animate-scale-in">
              <Sparkles className="h-3.5 w-3.5" /> Week cleared. That&rsquo;s how it feels in TaskTrack.
            </p>
          )}
        </div>
      </div>
    </Tilt>
  );
}
