'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, X, ExternalLink, Layers, Loader2, Download, PenLine, PlayCircle } from 'lucide-react';
import { downloadSlidesPptx } from '@/lib/export-slides';
import { cn } from '@/lib/utils';
import { saveDeck } from '@/lib/spaced-review';
import { youtubeSearchUrl, type QuizData, type FlashcardsData, type PlanSession, type StudyPlanData, type SlidesData } from '@/lib/study-modes';

// ---------------------------------------------------------------------------
// Quiz — one question at a time, immediate feedback, score and weak topics
// ---------------------------------------------------------------------------

interface QuizViewProps {
  data: QuizData;
  /** Called once with the full result when the student reaches the results screen. */
  onFinish?: (result: {
    score: number;
    total: number;
    answers: { question: string; chosen: string; chosenIndex: number; correct: boolean }[];
    weakTopics: string[];
  }) => void;
}

export function QuizView({ data, onFinish }: QuizViewProps) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<{ chosen: number; correct: boolean }[]>([]);
  const [finished, setFinished] = useState(false);
  // Report each finished round exactly once, even if the student retakes the quiz.
  const reportedRef = useRef(false);

  const total = data.questions.length;
  const question = data.questions[index];

  const confirm = () => {
    if (selected === null) return;
    const correct = selected === question.answerIndex;
    setAnswers((prev) => [...prev, { chosen: selected, correct }]);
    setFinished(true);
  };

  const next = () => {
    setFinished(false);
    setSelected(null);
    if (index + 1 >= total) {
      setIndex(total);
    } else {
      setIndex(index + 1);
    }
  };

  const restart = () => {
    reportedRef.current = false;
    setIndex(0);
    setSelected(null);
    setAnswers([]);
    setFinished(false);
  };

  // The results screen is only reached once per round; useEffect keeps the
  // report out of render so StrictMode double-invocations cannot double-save.
  useEffect(() => {
    if (index < total || reportedRef.current || answers.length < total) return;
    reportedRef.current = true;
    onFinish?.({
      score: answers.filter((a) => a.correct).length,
      total,
      answers: data.questions.map((q, i) => ({
        question: q.question,
        chosen: q.options[answers[i]?.chosen ?? -1] ?? '',
        chosenIndex: answers[i]?.chosen ?? -1,
        correct: answers[i]?.correct ?? false,
      })),
      weakTopics:
        data.weakTopics.length > 0
          ? data.weakTopics
          : data.questions.filter((_, i) => answers[i] && !answers[i].correct).map((q) => q.question),
    });
  }, [index, total, answers, data.questions, data.weakTopics, onFinish]);

  if (index >= total) {
    const score = answers.filter((a) => a.correct).length;
    const percent = Math.round((score / total) * 100);
    const missed = data.questions.filter((_, i) => answers[i] && !answers[i].correct);
    const weakTopics = data.weakTopics.length > 0
      ? data.weakTopics
      : missed.map((q) => q.question);

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Quiz complete</p>
          <p className="text-4xl font-bold mt-1">{score}/{total}</p>
          <p className="text-sm text-muted-foreground mt-1">{percent}% correct</p>
        </div>

        {weakTopics.length > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">Revise these topics</p>
            <ul className="space-y-1.5">
              {weakTopics.map((t, i) => (
                <li key={i} className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">- {t}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={restart}
            className="text-xs px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors font-medium"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const answer = answers[index];
  const revealed = Boolean(answer);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Question {index + 1} of {total}
        </p>
        <p className="text-xs font-medium text-muted-foreground">
          Score {answers.filter((a) => a.correct).length}/{answers.length}
        </p>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full gradient-blue transition-all duration-300"
          style={{ width: `${(index / total) * 100}%` }}
        />
      </div>

      <p className="text-sm font-medium leading-relaxed">{question.question}</p>

      <div className="space-y-2">
        {question.options.map((option, i) => {
          const isCorrect = i === question.answerIndex;
          const isChosen = i === selected;
          return (
            <button
              key={i}
              onClick={() => !revealed && setSelected(i)}
              disabled={revealed}
              className={cn(
                'w-full text-left text-sm px-3 py-2.5 rounded-lg border transition-colors flex items-start gap-2',
                !revealed && 'hover:border-primary/50',
                !revealed && isChosen && 'border-primary bg-primary/5',
                !revealed && !isChosen && 'border-border bg-card',
                revealed && isCorrect && 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30',
                revealed && !isCorrect && isChosen && 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30',
                revealed && !isCorrect && !isChosen && 'border-border bg-card opacity-60'
              )}
            >
              <span className="font-semibold flex-shrink-0">{String.fromCharCode(65 + i)}.</span>
              <span className="flex-1">{option}</span>
              {revealed && isCorrect && <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />}
              {revealed && !isCorrect && isChosen && <X className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>

      {revealed && (
        <div className="rounded-lg bg-muted p-3">
          <p className="text-xs font-semibold mb-1">
            {answer.correct ? 'Correct' : 'Not quite'}
          </p>
          {question.explanation && (
            <p className="text-xs leading-relaxed text-muted-foreground">{question.explanation}</p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        {!revealed ? (
          <button
            onClick={confirm}
            disabled={selected === null}
            className="text-xs px-4 py-2 rounded-lg bg-navy-600 hover:bg-navy-700 text-white font-medium transition-colors disabled:opacity-40"
          >
            Check answer
          </button>
        ) : (
          <button
            onClick={next}
            className="text-xs px-4 py-2 rounded-lg bg-navy-600 hover:bg-navy-700 text-white font-medium transition-colors"
          >
            {index + 1 >= total ? 'See results' : 'Next question'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flashcards — one card at a time with reveal and next
// ---------------------------------------------------------------------------

interface FlashcardsViewProps {
  data: FlashcardsData;
  /** When provided, the deck can be saved to the persistent Review queue. */
  deckDefaults?: { taskId: string | null; sessionId: string };
}

export function FlashcardsView({ data, deckDefaults }: FlashcardsViewProps) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const total = data.cards.length;
  const card = data.cards[index];

  const saveAsDeck = async () => {
    if (!deckDefaults || saveState === 'saving' || saveState === 'saved') return;
    setSaveState('saving');
    try {
      await saveDeck({
        title: data.cards[0]?.front ? `${data.cards[0].front.slice(0, 60)}` : 'Flashcard deck',
        cards: data.cards,
        taskId: deckDefaults.taskId,
        sessionId: deckDefaults.sessionId,
      });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const go = (delta: number) => {
    setRevealed(false);
    setIndex((i) => Math.min(Math.max(i + delta, 0), total - 1));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Card {index + 1} of {total}</p>
        <button
          onClick={() => setRevealed((r) => !r)}
          className="text-xs text-primary hover:underline font-medium"
        >
          {revealed ? 'Hide answer' : 'Reveal answer'}
        </button>
      </div>

      <button
        onClick={() => setRevealed((r) => !r)}
        className={cn(
          'w-full min-h-[160px] rounded-xl border-2 p-5 text-left transition-all',
          revealed
            ? 'border-primary/40 bg-primary/5'
            : 'border-border bg-card hover:border-primary/30'
        )}
      >
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
          {revealed ? 'Back' : 'Front'}
        </p>
        <p className="text-sm font-medium leading-relaxed">{card.front}</p>
        {revealed && (
          <>
            <div className="h-px bg-border my-3" />
            <p className="text-sm leading-relaxed">{card.back}</p>
          </>
        )}
      </button>

      <div className="flex items-center justify-between">
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          className="text-xs px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent font-medium transition-colors disabled:opacity-40"
        >
          Previous card
        </button>
        <div className="flex gap-1.5">
          {data.cards.map((_, i) => (
            <span
              key={i}
              className={cn('w-1.5 h-1.5 rounded-full', i === index ? 'bg-primary' : 'bg-muted')}
            />
          ))}
        </div>
        <button
          onClick={() => go(1)}
          disabled={index === total - 1}
          className="text-xs px-3 py-2 rounded-lg bg-navy-600 hover:bg-navy-700 text-white font-medium transition-colors disabled:opacity-40"
        >
          Next card
        </button>
      </div>

      {deckDefaults && (
        <div className="flex items-center justify-end gap-2">
          {saveState === 'error' && (
            <span className="text-[11px] text-destructive">Could not save — try again.</span>
          )}
          <button
            onClick={saveAsDeck}
            disabled={saveState === 'saving' || saveState === 'saved'}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent font-medium transition-colors disabled:opacity-60"
          >
            {saveState === 'saving' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            {saveState === 'saved' ? 'Saved to Review' : 'Save to Review'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Study plan — dates, focus, topics
// ---------------------------------------------------------------------------

export function PlanView({ data, onPractice }: { data: StudyPlanData; onPractice?: (session: PlanSession) => void }) {
  return (
    <div className="space-y-4">
      {data.summary && <p className="text-sm leading-relaxed">{data.summary}</p>}

      {data.compressed && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3">
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            This plan is compressed because the deadline is very close. Only sessions that genuinely fit
            are included.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {data.sessions.map((s, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold">{s.focus}</p>
              <div className="flex items-center gap-2">
                {s.minutes && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {s.minutes} min
                  </span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  {s.date}
                </span>
              </div>
            </div>
            {s.topics.length > 0 && (
              <ul className="mt-2 space-y-1">
                {s.topics.map((t, j) => (
                  <li key={j} className="text-xs text-muted-foreground leading-relaxed">- {t}</li>
                ))}
              </ul>
            )}
            {((s.videos?.length ?? 0) > 0 || s.practice || s.check) && (
              <ol className="mt-3 space-y-2 border-t border-border pt-3">
                {(s.videos?.length ?? 0) > 0 && (
                  <li className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600"><PlayCircle className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">1 · Watch</p>
                      {s.videos!.map((v, k) => (
                        <a key={k} href={youtubeSearchUrl(v)} target="_blank" rel="noopener noreferrer"
                          className="group flex items-start gap-1.5 text-xs font-medium text-foreground hover:text-primary">
                          <span className="text-muted-foreground">Video {k + 1}:</span>
                          <span className="underline decoration-dotted underline-offset-2 group-hover:decoration-solid">
                            {v.title || v.search}{v.channel ? ` · ${v.channel}` : ''}
                          </span>
                          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                        </a>
                      ))}
                    </div>
                  </li>
                )}
                {s.practice && (
                  <li className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><PenLine className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">2 · Practise</p>
                      <p className="text-xs leading-relaxed">{s.practice}</p>
                      {onPractice && (
                        <button type="button" onClick={() => onPractice(s)}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90">
                          <PenLine className="h-3 w-3" /> Practise with TaskTrack AI
                        </button>
                      )}
                    </div>
                  </li>
                )}
                {s.check && (
                  <li className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">3 · Check yourself</p>
                      <p className="text-xs leading-relaxed">{s.check}</p>
                    </div>
                  </li>
                )}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Study slides — slide cards
// ---------------------------------------------------------------------------

export function SlidesView({ data }: { data: SlidesData }) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await downloadSlidesPptx(data);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {data.title && <p className="text-sm font-semibold">{data.title}</p>}
          {data.subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{data.subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={download}
          disabled={saving}
          title="Download as PowerPoint. Opens in Google Slides, PowerPoint and Keynote."
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download slides
        </button>
      </div>
      {failed && <p className="text-xs text-destructive">The download didn’t work. Please try again.</p>}
      {data.slides.map((slide, i) => (
        <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-navy-900 text-white flex items-center gap-2">
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/15">
              Slide {i + 1}
            </span>
            <p className="text-sm font-semibold truncate">{slide.heading}</p>
          </div>
          <div className="p-4 space-y-2">
            <ul className="space-y-1.5">
              {slide.bullets.map((b, j) => (
                <li key={j} className="text-sm leading-relaxed flex gap-2">
                  <span className="text-primary flex-shrink-0 mt-0.5">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            {slide.example && (
              <div className="rounded-lg bg-muted p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Example</p>
                <p className="text-xs leading-relaxed">{slide.example}</p>
              </div>
            )}
            {slide.notes && (
              <p className="border-l-2 border-primary/40 pl-2.5 text-xs italic leading-relaxed text-muted-foreground">
                {slide.notes}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
