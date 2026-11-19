'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, X, ExternalLink, Layers, Loader2, Download, PenLine, PlayCircle } from 'lucide-react';
import { downloadSlidesPptx } from '@/lib/export-slides';
import { cn } from '@/lib/utils';
import { saveDeck } from '@/lib/spaced-review';
import { useVideoPlayer } from '@/components/video-player';
import { planPlaylist, quizXp, videoSearch, type QuizData, type FlashcardsData, type PlanSession, type StudyPlanData, type SlidesData, type SuggestedVideo, type VideosData } from '@/lib/study-modes';
import { setVideoWatched, useWatchedVideos, videoKey } from '@/lib/video-progress';

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
  /** Speed round: the whole quiz must be finished within this many seconds. */
  timeLimitSec?: number;
}

export function QuizView({ data, onFinish, timeLimitSec }: QuizViewProps) {
  const watch = useVideoPlayer();
  const [index, setIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimitSec ?? 0);
  const [started, setStarted] = useState(!timeLimitSec);
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
    setTimeLeft(timeLimitSec ?? 0);
    setStarted(!timeLimitSec);
    reportedRef.current = false;
    setIndex(0);
    setSelected(null);
    setAnswers([]);
    setFinished(false);
  };

  // Speed round clock: when it hits zero, every unanswered question counts as wrong.
  useEffect(() => {
    if (!timeLimitSec || !started || index >= total) return;
    if (timeLeft <= 0) {
      setAnswers((prev) => [...prev, ...Array.from({ length: Math.max(0, total - prev.length) }, () => ({ chosen: -1, correct: false }))]);
      setFinished(false);
      setIndex(total);
      return;
    }
    const t = window.setTimeout(() => setTimeLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [timeLimitSec, started, timeLeft, index, total]);

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
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {timeLimitSec ? (timeLeft <= 0 ? '⏱️ Time’s up!' : `⚡ Done with ${timeLeft}s to spare`) : 'Quiz complete'}
          </p>
          <p className="text-4xl font-bold mt-1">{score}/{total}</p>
          <p className="text-sm text-muted-foreground mt-1">{percent}% correct</p>
          {quizXp(score, total) > 0 && (
            <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              +{quizXp(score, total)} XP{score === total && total >= 3 ? ' · perfect score bonus' : ''}
            </p>
          )}
        </div>

        {weakTopics.length > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">Revise these topics</p>
            <ul className="space-y-1.5">
              {weakTopics.map((t, i) => (
                <li key={i} className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                  <span>- {t}</span>{' '}
                  <button
                    type="button"
                    onClick={() => watch({ search: `${t.slice(0, 90)} explained`, label: t.slice(0, 90) })}
                    className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-red-700 underline-offset-2 hover:underline dark:text-red-400"
                  >
                    <PlayCircle className="w-3.5 h-3.5" /> Watch a video
                  </button>
                </li>
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

  if (timeLimitSec && !started) {
    return (
      <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-5 text-center dark:border-amber-900 dark:from-amber-950/30 dark:to-orange-950/30">
        <p className="text-3xl">⚡</p>
        <p className="mt-1 text-lg font-bold">Speed round</p>
        <p className="mt-1 text-sm text-muted-foreground">{total} questions, {timeLimitSec} seconds. Go fast, earn XP.</p>
        <button onClick={() => setStarted(true)} className="mt-4 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          Start!
        </button>
      </div>
    );
  }

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
      {timeLimitSec ? (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full transition-all duration-1000 ease-linear', timeLeft <= 10 ? 'bg-red-500' : 'bg-amber-500')}
              style={{ width: `${(timeLeft / timeLimitSec) * 100}%` }}
            />
          </div>
          <span className={cn('w-10 text-right text-sm font-bold tabular-nums', timeLeft <= 10 && 'text-red-600')}>{timeLeft}s</span>
        </div>
      ) : (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full gradient-blue transition-all duration-300"
            style={{ width: `${(index / total) * 100}%` }}
          />
        </div>
      )}

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
  const watch = useVideoPlayer();
  const watched = useWatchedVideos();
  // Videos are numbered across the whole plan: Video 1, Video 2… in the order to watch them.
  const playlist = planPlaylist(data);
  const firstOfSession = data.sessions.map((_, i) => playlist.findIndex((v) => v.session === i));
  const doneCount = playlist.filter((v) => watched.has(videoKey(v.search))).length;
  const nextUp = Math.max(0, playlist.findIndex((v) => !watched.has(videoKey(v.search))));
  return (
    <div className="space-y-4">
      {data.summary && <p className="text-sm leading-relaxed">{data.summary}</p>}

      {playlist.length > 0 && (
        <VideoPlanBar
          total={playlist.length}
          done={doneCount}
          nextIndex={nextUp}
          onPlay={(i) => watch({ ...playlist[i], playlist, index: i })}
        />
      )}

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
                      {s.videos!.map((v, k) => {
                        const n = firstOfSession[i] + k;
                        const seen = watched.has(videoKey(videoSearch(v)));
                        return (
                        <button key={k} type="button"
                          onClick={() => (n >= 0 ? watch({ ...playlist[n], playlist, index: n }) : watch({ search: videoSearch(v), label: v.title || v.search }))}
                          className="group flex items-start gap-1.5 text-left text-xs font-medium text-foreground hover:text-primary">
                          <span className={cn('shrink-0', seen ? 'text-emerald-600' : 'text-muted-foreground')}>
                            {seen && <Check className="mr-0.5 inline h-3 w-3" />}Video {n >= 0 ? n + 1 : k + 1}:
                          </span>
                          <span className="underline decoration-dotted underline-offset-2 group-hover:decoration-solid">
                            {v.title || v.search}{v.channel ? ` · ${v.channel}` : ''}
                          </span>
                          <PlayCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-600" />
                        </button>
                        );
                      })}
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

// ---------------------------------------------------------------------------
// Video plan: Video 1, Video 2… in the order to watch them, played in the app
// ---------------------------------------------------------------------------

function VideoPlanBar({ total, done, nextIndex, onPlay }: { total: number; done: number; nextIndex: number; onPlay: (i: number) => void }) {
  const allDone = done >= total;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-900/60 dark:bg-red-950/20">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {allDone ? 'Video plan done 🎉' : `Video plan · ${total} video${total === 1 ? '' : 's'}`}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-red-100 dark:bg-red-950" aria-hidden>
            <div className="h-full rounded-full bg-red-600 transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">{done} of {total} watched</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onPlay(allDone ? 0 : nextIndex)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
      >
        <PlayCircle className="h-4 w-4" />
        {allDone ? 'Watch again' : done === 0 ? 'Start with Video 1' : `Continue: Video ${nextIndex + 1}`}
      </button>
    </div>
  );
}

export function VideosView({ data }: { data: VideosData }) {
  const watch = useVideoPlayer();
  const watched = useWatchedVideos();
  const playlist = data.videos.map((v) => ({ search: videoSearch(v), label: v.title || v.search }));
  const isDone = (v: SuggestedVideo) => watched.has(videoKey(videoSearch(v)));
  const done = data.videos.filter(isDone).length;
  const nextIndex = Math.max(0, data.videos.findIndex((v) => !isDone(v)));
  const play = (i: number) => watch({ ...playlist[i], playlist, index: i });
  const hasDays = data.videos.some((v) => v.day);

  return (
    <div className="space-y-3">
      {data.summary && <p className="text-sm leading-relaxed">{data.summary}</p>}
      <VideoPlanBar total={data.videos.length} done={done} nextIndex={nextIndex} onPlay={play} />

      <ol className="space-y-2">
        {data.videos.map((v, i) => {
          const seen = isDone(v);
          const newDay = hasDays && v.day && v.day !== data.videos[i - 1]?.day;
          const dayMinutes = newDay
            ? data.videos.filter((x) => x.day === v.day).reduce((sum, x) => sum + (x.minutes ?? 0), 0)
            : 0;
          return (
            <li key={i} className="space-y-2">
              {newDay && (
                <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Day {v.day}{dayMinutes ? ` · about ${dayMinutes} min` : ''}
                </p>
              )}
              <div
                className={cn(
                  'flex gap-3 rounded-xl border bg-card p-3 transition-colors',
                  seen ? 'border-emerald-200 dark:border-emerald-900/60' : 'border-border hover:border-red-300 dark:hover:border-red-900'
                )}
              >
                <button
                  type="button"
                  onClick={() => setVideoWatched(videoSearch(v), !seen)}
                  aria-label={seen ? `Mark Video ${i + 1} as not watched` : `Mark Video ${i + 1} as watched`}
                  className={cn(
                    'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold',
                    seen ? 'bg-emerald-600 text-white' : 'bg-red-600/10 text-red-700 dark:text-red-400'
                  )}
                >
                  {seen ? <Check className="h-4 w-4" /> : i + 1}
                </button>
                <button type="button" onClick={() => play(i)} className="group min-w-0 flex-1 text-left">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">Video {i + 1}</p>
                  <p className="text-sm font-semibold leading-snug group-hover:text-red-700 dark:group-hover:text-red-400">
                    {v.title || v.search}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[v.channel, v.minutes ? `about ${v.minutes} min` : ''].filter(Boolean).join(' · ') || 'YouTube'}
                  </p>
                  {v.why && <p className="mt-1.5 text-xs leading-relaxed">{v.why}</p>}
                  {v.watchFor && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">Note down:</span> {v.watchFor}
                    </p>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => play(i)}
                  className="self-center rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
                >
                  {seen ? 'Rewatch' : 'Watch'}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-muted-foreground">
        Videos play right here in TaskTrack, one after another. Only safe-search educational videos are shown. When you&rsquo;re done, take a quiz to check you&rsquo;ve got it.
      </p>
    </div>
  );
}
