'use client';

import { useState } from 'react';
import { Check, RotateCw, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from '@/components/landing/reveal';

/**
 * Interactive preview of a study session. The content is a hand-written sample
 * (labelled "Example"), showing the shape of what each tool produces in the app.
 */

type Tool = 'explain' | 'flashcards' | 'quiz' | 'plan';

const TOOLS: { id: Tool; label: string; blurb: string }[] = [
  { id: 'explain', label: 'Explain', blurb: 'Get the topic broken down in plain language.' },
  { id: 'flashcards', label: 'Flashcards', blurb: 'Turn the task into cards you can flip through.' },
  { id: 'quiz', label: 'Quiz', blurb: 'Test yourself and see what you got right.' },
  { id: 'plan', label: 'Study plan', blurb: 'Split the work into sessions before the deadline.' },
];

const CARDS = [
  { front: 'What is the function of the mitochondria?', back: 'It releases energy from glucose through aerobic respiration, producing ATP for the cell.' },
  { front: 'Which organelle controls what enters and leaves the cell?', back: 'The cell membrane. It is selectively permeable.' },
  { front: 'Name one structure found in plant cells but not animal cells.', back: 'The cell wall (also chloroplasts and a large permanent vacuole).' },
];

const QUIZ = {
  question: 'Which organelle is the site of protein synthesis?',
  options: ['Nucleus', 'Ribosome', 'Mitochondrion', 'Vacuole'],
  answer: 1,
  why: 'Ribosomes read mRNA and join amino acids together to build proteins.',
};

const PLAN = [
  { when: 'Today', what: 'Read notes on organelles and their functions', mins: 25 },
  { when: 'Tomorrow', what: 'Flashcards: plant vs animal cells', mins: 20 },
  { when: 'Thursday', what: 'Practice quiz, then review mistakes', mins: 30 },
];

function ExplainView() {
  return (
    <div className="space-y-3 text-[15px] leading-7 text-slate-700">
      <p>
        Think of a cell as a tiny factory. Each <strong className="text-[#243B64]">organelle</strong> is a department with one job.
      </p>
      <ul className="space-y-2">
        {[
          ['Nucleus', 'holds the DNA and gives the instructions.'],
          ['Ribosomes', 'build proteins from those instructions.'],
          ['Mitochondria', 'release the energy that keeps everything running.'],
        ].map(([name, job]) => (
          <li key={name} className="flex gap-2.5">
            <span className="mt-2.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#22B29E]" />
            <span>
              <strong className="text-[#243B64]">{name}</strong> {job}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FlashcardsView() {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = CARDS[index];

  return (
    <div>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? 'Show the question' : 'Show the answer'}
        className="group block h-44 w-full [perspective:1000px] focus-visible:outline-none"
      >
        <span
          className={cn(
            'relative block h-full w-full rounded-2xl transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none group-focus-visible:ring-2 group-focus-visible:ring-[#315EDB]',
            flipped && '[transform:rotateY(180deg)]'
          )}
        >
          <span className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 text-center [backface-visibility:hidden]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#315EDB]">Question</span>
            <span className="mt-2 text-base font-semibold text-[#243B64]">{card.front}</span>
            <span className="mt-3 text-xs text-slate-400">Tap to flip</span>
          </span>
          <span className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-[#243B64] p-5 text-center text-white [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5FD3C0]">Answer</span>
            <span className="mt-2 text-[15px] leading-6">{card.back}</span>
          </span>
        </span>
      </button>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          Card {index + 1} of {CARDS.length}
        </span>
        <button
          type="button"
          onClick={() => {
            setFlipped(false);
            setIndex((i) => (i + 1) % CARDS.length);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#315EDB] transition-colors hover:bg-[#315EDB]/10"
        >
          Next card <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function QuizView() {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;

  return (
    <div>
      <p className="text-base font-semibold text-[#243B64]">{QUIZ.question}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {QUIZ.options.map((option, i) => {
          const correct = i === QUIZ.answer;
          const chosen = i === picked;
          return (
            <button
              key={option}
              type="button"
              disabled={answered}
              onClick={() => setPicked(i)}
              className={cn(
                'flex items-center justify-between rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition-all',
                !answered && 'border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-[#315EDB]/50 hover:shadow-sm',
                answered && correct && 'border-emerald-300 bg-emerald-50 text-emerald-800',
                answered && chosen && !correct && 'border-red-300 bg-red-50 text-red-800',
                answered && !chosen && !correct && 'border-slate-200 bg-white text-slate-400'
              )}
            >
              {option}
              {answered && correct && <Check className="h-4 w-4" />}
              {answered && chosen && !correct && <X className="h-4 w-4" />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 min-h-[3rem]" aria-live="polite">
        {answered && (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm leading-6 text-slate-600">
              <strong className={picked === QUIZ.answer ? 'text-emerald-700' : 'text-red-700'}>
                {picked === QUIZ.answer ? 'Correct.' : 'Not quite.'}
              </strong>{' '}
              {QUIZ.why}
            </p>
            <button type="button" onClick={() => setPicked(null)} className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#315EDB] hover:bg-[#315EDB]/10">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanView() {
  return (
    <ol className="space-y-2.5">
      {PLAN.map((step, i) => (
        <li key={step.when} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#315EDB]/10 text-xs font-bold text-[#315EDB]">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{step.when}</p>
            <p className="truncate text-sm font-medium text-[#243B64]">{step.what}</p>
          </div>
          <span className="flex-shrink-0 text-xs font-semibold text-slate-500">{step.mins} min</span>
        </li>
      ))}
    </ol>
  );
}

export function StudyShowcase() {
  const [tool, setTool] = useState<Tool>('flashcards');
  const active = TOOLS.find((t) => t.id === tool)!;

  return (
    <section id="study" className="relative overflow-hidden bg-[#243B64] py-20 lg:py-28">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(44rem 30rem at 0% 0%, rgba(49,94,219,0.55), transparent 65%), radial-gradient(40rem 28rem at 100% 100%, rgba(34,178,158,0.30), transparent 65%)',
        }}
      />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-8">
        <Reveal className="min-w-0">
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-[#5FD3C0]">
            <Sparkles className="h-4 w-4" /> AI study sessions
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-[2.6rem] sm:leading-[1.12]">
            Turn any task into
            <br className="hidden sm:block" /> <span className="text-[#5FD3C0]">a study session.</span>
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-8 text-blue-100">
            Open a task and pick a tool. TaskTrack&rsquo;s AI uses the task itself to explain the topic, quiz you, make flashcards, or plan your revision.
          </p>
          <ul className="mt-8 space-y-3">
            {['Starts from your real task, so it stays on topic', 'Quizzes show which answers you got right', 'Free plan includes 7 AI messages a day'].map((line) => (
              <li key={line} className="flex items-center gap-3 text-[15px] text-blue-50">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#22B29E]/25">
                  <Check className="h-3.5 w-3.5 text-[#5FD3C0]" strokeWidth={3} />
                </span>
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-blue-200/80">Try it: switch tools, flip the card, answer the quiz.</p>
        </Reveal>

        <Reveal delay={150} className="min-w-0">
          <div className="rounded-3xl border border-white/50 bg-[#F6F5F1] p-4 shadow-2xl shadow-[#0b1530]/50 sm:p-5">
            <div className="flex items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Study session · Example</p>
                <p className="truncate text-base font-semibold text-[#243B64]">Formative quiz: cell structure</p>
              </div>
              <span className="flex-shrink-0 rounded-full bg-[#22B29E]/15 px-2.5 py-1 text-[11px] font-semibold text-[#17806F]">Biology</span>
            </div>

            <div role="tablist" aria-label="Study tools" className="mt-4 grid grid-cols-4 gap-1 rounded-xl bg-white p-1 shadow-[0_1px_2px_rgba(23,38,75,0.06)]">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tool === t.id}
                  onClick={() => setTool(t.id)}
                  className={cn(
                    'whitespace-nowrap rounded-lg px-0.5 py-2 text-xs font-semibold transition-all sm:px-1 sm:text-sm',
                    tool === t.id ? 'bg-[#315EDB] text-white shadow-sm shadow-[#315EDB]/30' : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <p className="mt-3 px-1 text-sm text-slate-500">{active.blurb}</p>

            <div key={tool} role="tabpanel" className="mt-3 min-h-[15rem] animate-fade-in rounded-2xl bg-white/60 p-4 motion-reduce:animate-none">
              {tool === 'explain' && <ExplainView />}
              {tool === 'flashcards' && <FlashcardsView />}
              {tool === 'quiz' && <QuizView />}
              {tool === 'plan' && <PlanView />}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
