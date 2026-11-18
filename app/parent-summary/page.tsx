'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { CheckCircle2, CalendarClock, Flame, Loader2, ListTodo } from 'lucide-react';
import { Logo } from '@/components/logo';
import { supabase } from '@/lib/supabase/client';

interface Summary {
  first_name: string;
  today: string;
  streak: number;
  study_days: number;
  done: { title: string; subject: string | null; date: string }[];
  upcoming: { title: string; subject: string | null; date: string }[];
  exams: { subject: string; paper: string | null; kind: string; date: string }[];
}

function day(d: string): string {
  try {
    return format(parseISO(d), 'EEE d MMM');
  } catch {
    return d;
  }
}

/**
 * The read-only weekly summary a parent opens from their child's link. No sign-in.
 * The child chose to share it and can turn it off at any time.
 */
export default function ParentSummaryPage() {
  const [state, setState] = useState<'loading' | 'invalid' | 'ok'>('loading');
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') ?? '';
    if (!/^[a-f0-9]{48}$/.test(t)) {
      setState('invalid');
      return;
    }
    supabase.rpc('get_parent_summary', { p_token: t }).then(({ data: d, error }) => {
      if (error || !d) setState('invalid');
      else {
        setData(d as Summary);
        setState('ok');
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#F7F5F3] px-4 py-10 text-[#17264B] sm:py-16">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="inline-flex items-center gap-3">
          <Logo size={40} />
          <span className="text-xl font-bold tracking-tight">TaskTrack</span>
        </Link>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {state === 'loading' && (
            <div className="flex items-center gap-3 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading the summary…
            </div>
          )}

          {state === 'invalid' && (
            <>
              <h1 className="text-2xl font-bold">This link doesn’t work</h1>
              <p className="mt-3 leading-7 text-slate-600">
                It may be incomplete, or your child may have made a new link or turned sharing off. Ask them to send the
                latest link from Settings &rarr; Privacy in TaskTrack.
              </p>
            </>
          )}

          {state === 'ok' && data && (
            <div className="space-y-7">
              <div>
                <h1 className="text-2xl font-bold">{data.first_name}&rsquo;s week</h1>
                <p className="mt-1 text-sm text-slate-500">Updated live &middot; {day(data.today)}</p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} value={data.done.length} label="tasks done" />
                <Stat icon={<Flame className="h-5 w-5 text-orange-500" />} value={data.streak} label="day streak" />
                <Stat icon={<CalendarClock className="h-5 w-5 text-sky-600" />} value={data.study_days} label="of 7 days studied" />
              </div>

              <Section title="Finished in the last 7 days" icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}>
                {data.done.length === 0 ? (
                  <Empty>Nothing marked as done yet this week.</Empty>
                ) : (
                  data.done.map((t, i) => <Row key={i} title={t.title} subject={t.subject} date={day(t.date)} />)
                )}
              </Section>

              <Section title="Due in the next 7 days" icon={<ListTodo className="h-4 w-4 text-sky-600" />}>
                {data.upcoming.length === 0 ? (
                  <Empty>Nothing due in the next week.</Empty>
                ) : (
                  data.upcoming.map((t, i) => <Row key={i} title={t.title} subject={t.subject} date={day(t.date)} />)
                )}
              </Section>

              {data.exams.length > 0 && (
                <Section title="Exams in the next 30 days" icon={<CalendarClock className="h-4 w-4 text-red-500" />}>
                  {data.exams.map((e, i) => (
                    <Row key={i} title={`${e.subject}${e.paper ? ` · ${e.paper}` : ''}`} subject={e.kind === 'mock' ? 'Mock' : e.kind === 'final' ? 'Final' : e.kind === 'summative' ? 'Summative' : 'Test'} date={day(e.date)} />
                  ))}
                </Section>
              )}

              <p className="border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
                {data.first_name} chose to share this summary and can turn it off at any time. It never includes their
                notes, chats, drafts or grades. Bookmark this page to check in each week.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex justify-center">{icon}</div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">{icon} {title}</h2>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{children}</ul>
    </section>
  );
}

function Row({ title, subject, date }: { title: string; subject: string | null; date: string }) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
      <span className="min-w-0">
        <span className="block">{title}</span>
        {subject && <span className="block text-xs text-slate-500">{subject}</span>}
      </span>
      <span className="whitespace-nowrap text-xs text-slate-500">{date}</span>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-3 py-3 text-sm text-slate-500">{children}</li>;
}
