'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "What's going wrong this week?" Visitors pick the problem they actually have and
 * see which part of TaskTrack deals with it. Every answer describes a real feature.
 */

const PROBLEMS = [
  {
    id: 'forget',
    label: 'I keep forgetting deadlines',
    answer: 'Connect ManageBac or Google Classroom once and every deadline lands in one list, sorted by what’s due first. You get a reminder the day before, at a time you pick.',
    features: ['ManageBac sync', 'Google Classroom', 'Day-before reminders'],
    anchor: '#managebac',
  },
  {
    id: 'revise',
    label: 'I don’t know how to revise',
    answer: 'Open any task and the AI turns it into an explanation, flashcards and a quiz. Daily review then shows you the cards you got wrong first, five minutes at a time.',
    features: ['AI study sessions', 'Flashcards', 'Daily review'],
    anchor: '#study',
  },
  {
    id: 'draft',
    label: 'My draft needs feedback',
    answer: 'Upload a Word or PDF file, or paste it in. The AI Grader estimates a level for each IB criterion and tells you what to fix next. It never rewrites your work for you.',
    features: ['AI Grader', 'File upload', 'Criterion feedback'],
    anchor: '#grader',
  },
  {
    id: 'exams',
    label: 'Exams are coming',
    answer: 'Add your exam dates and see a countdown for each one, plus a revision timetable spread across the days you have left. Log your marks to see which subject needs you most.',
    features: ['Exam countdown', 'Revision timetable', 'Grade tracker'],
    anchor: '#features',
  },
  {
    id: 'alone',
    label: 'Studying alone is boring',
    answer: 'Make a private study room, share the code with friends, and ask the AI questions together. Keep a streak going with a study buddy so you both show up.',
    features: ['Group Study', 'Streak buddies'],
    anchor: '#grader',
  },
];

export function ProblemPicker() {
  const [id, setId] = useState(PROBLEMS[0].id);
  const p = PROBLEMS.find((x) => x.id === id)!;

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:gap-10">
      <div role="tablist" aria-label="Pick a problem" className="flex flex-col gap-2">
        {PROBLEMS.map((x) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={x.id === id}
            onClick={() => setId(x.id)}
            onMouseEnter={() => setId(x.id)}
            className={cn(
              'rounded-xl border px-4 py-3.5 text-left text-[15px] font-semibold transition-all',
              x.id === id
                ? 'border-[#243B64] bg-[#243B64] text-white shadow-md'
                : 'border-slate-200 bg-white text-[#243B64] hover:border-[#243B64]/40'
            )}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div key={p.id} role="tabpanel" className="animate-fade-in rounded-2xl border border-slate-200 bg-white p-6 motion-reduce:animate-none sm:p-8">
        <p className="text-sm font-medium text-slate-500">Here&rsquo;s what helps</p>
        <p className="mt-3 text-xl leading-8 text-[#243B64] sm:text-[1.4rem] sm:leading-9">{p.answer}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {p.features.map((f) => (
            <span key={f} className="rounded-md bg-[#F6F5F1] px-2.5 py-1 text-xs font-semibold text-slate-600">{f}</span>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/signup" className="inline-flex items-center gap-1.5 rounded-lg bg-[#315EDB] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#274DBE]">
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
          {p.anchor !== '#features' && (
            <a href={p.anchor} className="text-sm font-semibold text-[#315EDB] hover:underline">See it in action</a>
          )}
        </div>
      </div>
    </div>
  );
}
