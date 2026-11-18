'use client';

import { Bell, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/logo';
import { CalendarCheckIcon, ReminderIcon, UpcomingIcon } from '@/components/brand-icons';
import { Reveal, useInView } from '@/components/landing/reveal';

/** Illustrative entries only. Labelled "Example" in the visual. */
const ENTRIES = [
  { subject: 'English', colour: '#315EDB', title: 'Summative Assessment: comparative essay', due: 'Due tomorrow', priority: 'Urgent', tone: 'urgent' },
  { subject: 'Biology', colour: '#22B29E', title: 'Formative quiz: cell structure', due: 'Due Friday', priority: 'High', tone: 'high' },
  { subject: 'Design', colour: '#8B5CF6', title: 'Task 3: prototype and testing', due: 'Due next week', priority: 'Medium', tone: 'medium' },
] as const;

const BADGE: Record<string, string> = {
  urgent: 'bg-red-50 text-red-700 ring-red-200',
  high: 'bg-orange-50 text-orange-700 ring-orange-200',
  medium: 'bg-blue-50 text-blue-700 ring-blue-200/70',
};

const STEPS = [
  {
    icon: CalendarCheckIcon,
    title: 'Paste your ManageBac link once',
    body: 'Copy the calendar subscription link from ManageBac and paste it into TaskTrack. That’s the whole setup.',
  },
  {
    icon: UpcomingIcon,
    title: 'Deadlines sync every 5 minutes',
    body: 'New and changed deadlines appear on their own. If you’ve edited a task, your version is kept.',
  },
  {
    icon: ReminderIcon,
    title: 'Priorities and reminders, done for you',
    body: 'Summative work is marked Urgent and formative work High, and you get a notification the day before each due date.',
  },
];

function SyncVisual() {
  const [ref, play] = useInView<HTMLDivElement>({ threshold: 0.35 });

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[520px]">
      {/* ManageBac feed */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_-8px_rgba(23,38,75,0.18)]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">ManageBac calendar</p>
          <span className="text-[11px] font-medium text-slate-400">Example</span>
        </div>
        <div className="space-y-2">
          {ENTRIES.map((e) => (
            <div key={e.title} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: e.colour }} />
              <p className="min-w-0 flex-1 truncate text-[13px] text-slate-600">{e.title}</p>
              <span className="flex-shrink-0 text-[11px] text-slate-400">{e.due.replace('Due ', '')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Connector */}
      <div className="relative flex h-16 items-center justify-center">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[repeating-linear-gradient(to_bottom,#315EDB_0,#315EDB_5px,transparent_5px,transparent_10px)] opacity-40" />
        <span
          className={cn(
            'relative inline-flex items-center gap-1.5 rounded-full bg-[#243B64] px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-[#243B64]/25 transition-all duration-500',
            play ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
          )}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', play && 'animate-[spin_2.4s_linear_infinite] motion-reduce:animate-none')} />
          Syncs every 5 min
        </span>
      </div>

      {/* TaskTrack list */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_20px_44px_-12px_rgba(23,38,75,0.28)]">
        <div className="mb-3 flex items-center gap-2">
          <Logo size={24} />
          <p className="text-sm font-semibold text-[#243B64]">My Tasks</p>
        </div>
        <div className="space-y-2">
          {ENTRIES.map((e, i) => (
            <div
              key={e.title}
              style={{ transitionDelay: play ? `${450 + i * 260}ms` : '0ms' }}
              className={cn(
                'relative overflow-hidden rounded-xl border border-slate-200/80 bg-white py-2.5 pl-4 pr-3 transition-all duration-500 ease-out motion-reduce:transition-none',
                play ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0 motion-reduce:translate-x-0 motion-reduce:opacity-100'
              )}
            >
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: e.colour }} />
              <p className="truncate text-[13px] font-semibold text-[#202A3B]">{e.title}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${e.colour}14`, color: e.colour }}>
                  {e.subject}
                </span>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', BADGE[e.tone])}>{e.priority}</span>
                <span className="text-[11px] text-slate-500">{e.due}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reminder notification */}
      <div
        style={{ transitionDelay: play ? '1500ms' : '0ms' }}
        className={cn(
          'absolute -bottom-7 right-2 w-[250px] rounded-2xl border border-white/60 bg-white/95 p-3 shadow-[0_18px_40px_-10px_rgba(23,38,75,0.35)] backdrop-blur transition-all duration-500 ease-out sm:-right-10 motion-reduce:transition-none',
          play ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100'
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#243B64]">
            <Bell className="h-3.5 w-3.5 text-white" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[#202A3B]">Due tomorrow</p>
            <p className="truncate text-[11px] text-slate-500">Summative Assessment: comparative essay</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ManageBacShowcase() {
  return (
    <section id="managebac" className="relative overflow-hidden border-b border-slate-200 bg-white py-20 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:gap-20 lg:px-8">
        <div className="min-w-0">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">ManageBac integration</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-[2.6rem] sm:leading-[1.12]">
              Your ManageBac deadlines,
              <br className="hidden sm:block" /> <span className="text-[#22B29E]">already in TaskTrack.</span>
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-8 text-slate-600">
              Connect once and stop copying assignments by hand. Every deadline lands in your task list, sorted and ready to study for.
            </p>
          </Reveal>
          <div className="mt-10 space-y-6">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={120 * (i + 1)}>
                <div className="flex gap-4">
                  <s.icon size={40} />
                  <div>
                    <h3 className="font-semibold text-[#243B64]">{s.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
        <Reveal delay={150} className="min-w-0">
          <SyncVisual />
        </Reveal>
      </div>
    </section>
  );
}
