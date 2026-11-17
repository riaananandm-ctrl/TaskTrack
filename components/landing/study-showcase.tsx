'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Loader2, RotateCw, Sparkles, Wand2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from '@/components/landing/reveal';

/**
 * Homepage study demo. It opens on a hand-written example (labelled "Example");
 * visitors can type their own topic and get a real AI set from the try-study
 * function, which is rate-limited on the server because no sign-in is needed.
 */

type Tool = 'explain' | 'flashcards' | 'quiz' | 'plan';

interface Card { front: string; back: string }
interface Question { question: string; options: string[]; answer: number; why: string }
interface StudySet { title: string; subject: string; explain: string[]; cards: Card[]; quiz: Question[] }

const TOOLS: { id: Tool; label: string; blurb: string }[] = [
  { id: 'explain', label: 'Explain', blurb: 'The topic broken down in plain language.' },
  { id: 'flashcards', label: 'Flashcards', blurb: 'Cards you can flip through.' },
  { id: 'quiz', label: 'Quiz', blurb: 'Test yourself and see what you got right.' },
  { id: 'plan', label: 'Study plan', blurb: 'The work split into sessions before the deadline.' },
];

const EXAMPLE: StudySet = {
  title: 'Formative quiz: cell structure',
  subject: 'Biology',
  explain: [
    'Think of a cell as a tiny factory: each organelle is a department with one job.',
    'The nucleus holds the DNA and gives the instructions; ribosomes build proteins from them.',
    'Mitochondria release the energy (ATP) that keeps everything running.',
  ],
  cards: [
    { front: 'What is the function of the mitochondria?', back: 'It releases energy from glucose through aerobic respiration, producing ATP for the cell.' },
    { front: 'Which organelle controls what enters and leaves the cell?', back: 'The cell membrane. It is selectively permeable.' },
    { front: 'Name one structure found in plant cells but not animal cells.', back: 'The cell wall (also chloroplasts and a large permanent vacuole).' },
  ],
  quiz: [
    { question: 'Which organelle is the site of protein synthesis?', options: ['Nucleus', 'Ribosome', 'Mitochondrion', 'Vacuole'], answer: 1, why: 'Ribosomes read mRNA and join amino acids together to build proteins.' },
  ],
};

const IDEAS = ['Photosynthesis', 'The Cold War', 'Supply and demand', 'Quadratic equations', 'Romeo and Juliet'];

function planFor(set: StudySet) {
  const name = set.title.replace(/^Formative quiz:\s*/i, '');
  return [
    { when: 'Today', what: `Read the key points on ${name}`, mins: 20 },
    { when: 'Tomorrow', what: `Flashcards: ${set.cards.length} cards, weakest first`, mins: 15 },
    { when: 'Day 3', what: 'Practice quiz, then review mistakes', mins: 25 },
  ];
}

function ExplainView({ points }: { points: string[] }) {
  return (
    <ul className="space-y-3 text-[15px] leading-7 text-slate-700">
      {points.map((p) => (
        <li key={p} className="flex gap-2.5">
          <span className="mt-2.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#22B29E]" />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

function FlashcardsView({ cards }: { cards: Card[] }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[index];

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
          Card {index + 1} of {cards.length}
        </span>
        <button
          type="button"
          onClick={() => {
            setFlipped(false);
            setIndex((i) => (i + 1) % cards.length);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#315EDB] transition-colors hover:bg-[#315EDB]/10"
        >
          Next card <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function QuizView({ quiz }: { quiz: Question[] }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const q = quiz[index];
  const answered = picked !== null;
  const last = index === quiz.length - 1;

  const pick = (i: number) => {
    setPicked(i);
    if (i === q.answer) setScore((s) => s + 1);
  };

  return (
    <div>
      {quiz.length > 1 && (
        <p className="mb-1 text-xs font-medium text-slate-500">
          Question {index + 1} of {quiz.length} · {score} right so far
        </p>
      )}
      <p className="text-base font-semibold text-[#243B64]">{q.question}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.options.map((option, i) => {
          const correct = i === q.answer;
          const chosen = i === picked;
          return (
            <button
              key={`${i}-${option}`}
              type="button"
              disabled={answered}
              onClick={() => pick(i)}
              className={cn(
                'flex items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition-all',
                !answered && 'border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-[#315EDB]/50 hover:shadow-sm',
                answered && correct && 'border-emerald-300 bg-emerald-50 text-emerald-800',
                answered && chosen && !correct && 'border-red-300 bg-red-50 text-red-800',
                answered && !chosen && !correct && 'border-slate-200 bg-white text-slate-400'
              )}
            >
              {option}
              {answered && correct && <Check className="h-4 w-4 flex-shrink-0" />}
              {answered && chosen && !correct && <X className="h-4 w-4 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 min-h-[3rem]" aria-live="polite">
        {answered && (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm leading-6 text-slate-600">
              <strong className={picked === q.answer ? 'text-emerald-700' : 'text-red-700'}>
                {picked === q.answer ? 'Correct.' : 'Not quite.'}
              </strong>{' '}
              {q.why}
            </p>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                if (last) {
                  setIndex(0);
                  setScore(0);
                } else setIndex((n) => n + 1);
              }}
              className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#315EDB] hover:bg-[#315EDB]/10"
            >
              {quiz.length === 1 ? 'Try again' : last ? 'Start over' : 'Next'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanView({ set }: { set: StudySet }) {
  return (
    <ol className="space-y-2.5">
      {planFor(set).map((step, i) => (
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

async function fetchSet(topic: string): Promise<{ set?: StudySet; error?: string; limit?: boolean }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return { error: 'The demo is unavailable right now.' };
  try {
    const res = await fetch(`${base}/functions/v1/try-study`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic }),
    });
    const data = await res.json().catch(() => null);
    if (data?.ok && data.set) return { set: data.set as StudySet };
    return { error: data?.error ?? 'That didn’t work. Please try again.', limit: !!data?.limit };
  } catch {
    return { error: 'Couldn’t reach TaskTrack. Check your connection and try again.' };
  }
}

export function StudyShowcase() {
  const [tool, setTool] = useState<Tool>('flashcards');
  const [set, setSet] = useState<StudySet>(EXAMPLE);
  const [mine, setMine] = useState(false);
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [version, setVersion] = useState(0);
  const active = TOOLS.find((t) => t.id === tool)!;

  const make = async (value = topic) => {
    const t = value.trim();
    if (!t || loading) return;
    setTopic(t);
    setLoading(true);
    setError(null);
    const r = await fetchSet(t);
    setLoading(false);
    if (r.set) {
      setSet(r.set);
      setMine(true);
      setTool('flashcards');
      setVersion((v) => v + 1);
    } else {
      setError(r.error ?? null);
      setLimited(!!r.limit);
    }
  };

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
            Try it on your
            <br className="hidden sm:block" /> <span className="text-[#5FD3C0]">next test topic.</span>
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-8 text-blue-100">
            Type anything you&rsquo;re studying. You get a quick explanation, flashcards and a quiz in a few seconds. No account needed.
          </p>

          <form
            className="mt-7 flex max-w-lg gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void make();
            }}
          >
            <label htmlFor="try-topic" className="sr-only">Topic to study</label>
            <input
              id="try-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 80))}
              placeholder="e.g. the causes of World War I"
              className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-[15px] text-white placeholder:text-blue-200/70 outline-none backdrop-blur focus:border-[#5FD3C0] focus:bg-white/15"
            />
            <button
              type="submit"
              disabled={loading || !topic.trim()}
              className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-[#22B29E] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#22B29E]/25 transition hover:bg-[#1c9c8a] disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{loading ? 'Making…' : 'Make my set'}</span>
            </button>
          </form>
          <div className="mt-3 flex max-w-lg flex-wrap gap-2">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                disabled={loading}
                onClick={() => void make(idea)}
                className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-blue-100 transition hover:border-[#5FD3C0] hover:text-white disabled:opacity-50"
              >
                {idea}
              </button>
            ))}
          </div>
          <div aria-live="polite" className="mt-3 min-h-[1.5rem] max-w-lg text-sm">
            {error && (
              <p className="text-amber-200">
                {error}{' '}
                {limited && (
                  <Link href="/signup" className="font-semibold text-white underline">Sign up free</Link>
                )}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-blue-200/70">A few free tries a day. Made by AI, so double-check facts with your notes.</p>
        </Reveal>

        <Reveal delay={150} className="min-w-0">
          <div className="rounded-3xl border border-white/50 bg-[#F6F5F1] p-4 shadow-2xl shadow-[#0b1530]/50 sm:p-5">
            <div className="flex items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Study session · {mine ? 'Made just now' : 'Example'}
                </p>
                <p className="truncate text-base font-semibold text-[#243B64]">{set.title || topic}</p>
              </div>
              {set.subject && (
                <span className="flex-shrink-0 rounded-full bg-[#22B29E]/15 px-2.5 py-1 text-[11px] font-semibold text-[#17806F]">{set.subject}</span>
              )}
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

            <div key={`${tool}-${version}`} role="tabpanel" className="relative mt-3 min-h-[15rem] animate-fade-in rounded-2xl bg-white/60 p-4 motion-reduce:animate-none">
              {loading ? (
                <div className="space-y-3" aria-label="Making your study set">
                  <div className="h-5 w-3/4 animate-pulse rounded bg-slate-200" />
                  <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                </div>
              ) : (
                <>
                  {tool === 'explain' && <ExplainView points={set.explain} />}
                  {tool === 'flashcards' && <FlashcardsView cards={set.cards} />}
                  {tool === 'quiz' && <QuizView quiz={set.quiz} />}
                  {tool === 'plan' && <PlanView set={set} />}
                </>
              )}
            </div>

            {mine && !loading && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <button
                  type="button"
                  onClick={() => {
                    setSet(EXAMPLE);
                    setMine(false);
                    setVersion((v) => v + 1);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-[#243B64]"
                >
                  Back to the example
                </button>
                <Link href="/signup" className="inline-flex items-center gap-1 text-sm font-semibold text-[#315EDB] hover:underline">
                  Sign up free to study your own tasks <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
