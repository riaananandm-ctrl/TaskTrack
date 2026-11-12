'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import type { Subject, Task } from '@/lib/types';
import { gradeWork, type GradeResult } from '@/lib/ai-tools';
import { GraderIcon } from '@/components/brand-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const NO_TASK = 'none';
const MAX_WORK = 14000;

/** Colour for a band like "5-6": green for the top bands, amber in the middle, red low. */
function bandTone(band: string): string {
  const top = Math.max(...(band.match(/\d+/g) ?? []).map(Number), -1);
  if (top >= 7) return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900';
  if (top >= 5) return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900';
  if (top >= 3) return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900';
  if (top >= 0) return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900';
  return 'bg-muted text-muted-foreground ring-border';
}

export default function GraderPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [taskId, setTaskId] = useState(NO_TASK);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [programme, setProgramme] = useState<'MYP' | 'DP'>('MYP');
  const [criteria, setCriteria] = useState('');
  const [work, setWork] = useState('');
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [tasksRes, subjectsRes] = await Promise.all([
        supabase.from('tasks').select('*, subject:subjects(*)').eq('is_archived', false).neq('status', 'completed').order('due_date', { nullsFirst: false }).limit(100),
        supabase.from('subjects').select('*').eq('is_archived', false),
      ]);
      const loaded = (tasksRes.data as unknown as Task[]) || [];
      setTasks(loaded);
      setSubjects((subjectsRes.data as Subject[]) || []);
      // Arriving from a task ("Grade my work"): preselect it.
      const wanted = new URLSearchParams(window.location.search).get('task');
      const match = wanted ? loaded.find((t) => t.id === wanted) : null;
      if (match) applyTask(match);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const applyTask = (task: Task) => {
    setTaskId(task.id);
    setTitle(task.title);
    setSubject(task.subject?.name ?? '');
    // ManageBac descriptions often contain the criterion text: offer it as the rubric.
    setCriteria(task.description ?? '');
  };

  const onPickTask = (id: string) => {
    if (id === NO_TASK) {
      setTaskId(NO_TASK);
      return;
    }
    const task = tasks.find((t) => t.id === id);
    if (task) applyTask(task);
  };

  const words = useMemo(() => (work.trim() ? work.trim().split(/\s+/).length : 0), [work]);
  const canGrade = work.trim().length >= 80 && title.trim().length > 0 && !grading;

  const handleGrade = async () => {
    setGrading(true);
    setError(null);
    const response = await gradeWork({ title: title.trim(), subject: subject.trim(), programme, criteria: criteria.trim(), work: work.trim() });
    setGrading(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setResult(response.result);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-4">
        <GraderIcon size={52} />
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">AI Grader</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Paste your draft and get feedback against the IB criteria before you hand it in: an estimated level for each criterion, what&rsquo;s working, and what to fix.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ---------- Form ---------- */}
        <Card className="p-5 sm:p-6 space-y-5 h-fit">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="grader-task">Which task is this for?</Label>
              <Select value={taskId} onValueChange={onPickTask}>
                <SelectTrigger id="grader-task">
                  <SelectValue placeholder="Choose a task" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TASK}>Not in my list — I&rsquo;ll type it</SelectItem>
                  {tasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="grader-title">Task title</Label>
              <Input id="grader-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Summative: comparative essay" maxLength={200} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grader-subject">Subject</Label>
              <Input id="grader-subject" list="grader-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. English" maxLength={80} />
              <datalist id="grader-subjects">
                {subjects.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>Programme</Label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="IB programme">
                {(['MYP', 'DP'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={programme === p}
                    onClick={() => setProgramme(p)}
                    className={cn(
                      'rounded-md py-1.5 text-sm font-semibold transition-all',
                      programme === p ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="grader-criteria">Criteria or rubric (recommended)</Label>
            <Textarea
              id="grader-criteria"
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Paste the criteria your teacher gave you, e.g. Criterion A: Analysing… Leave empty to use the standard IB criteria for the subject."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="grader-work">Your work</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {words} {words === 1 ? 'word' : 'words'}
              </span>
            </div>
            <Textarea
              id="grader-work"
              value={work}
              onChange={(e) => setWork(e.target.value.slice(0, MAX_WORK))}
              rows={12}
              placeholder="Paste your essay, report or draft here."
              className="leading-relaxed"
            />
            {work.length >= MAX_WORK && <p className="text-xs text-amber-600">That&rsquo;s the maximum length. Only the first {MAX_WORK.toLocaleString()} characters are assessed.</p>}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <Button onClick={handleGrade} disabled={!canGrade} size="lg" className="w-full">
            {grading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {grading ? 'Reading your work…' : result ? 'Grade again' : 'Grade my work'}
          </Button>
          <p className="text-xs text-muted-foreground text-center">Uses one of your daily AI messages. Your work is sent to the AI to assess and isn&rsquo;t saved by TaskTrack.</p>
        </Card>

        {/* ---------- Result ---------- */}
        <div className="space-y-4 lg:order-none order-first">
          {!result && !grading && (
            <Card className="border-dashed p-8 text-center">
              <GraderIcon size={56} className="mx-auto" />
              <p className="mt-4 font-semibold">Your feedback will appear here</p>
              <ul className="mx-auto mt-4 max-w-xs space-y-2 text-left text-sm text-muted-foreground">
                {['An estimated level for each criterion', 'Evidence from your own writing', 'The three changes that matter most'].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" /> {line}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {grading && (
            <Card className="p-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 font-semibold">Reading your work against the criteria…</p>
              <p className="mt-1 text-sm text-muted-foreground">This usually takes 10–20 seconds.</p>
            </Card>
          )}

          {result && !grading && (
            <>
              <Card className="gradient-hero relative overflow-hidden border-0 p-6 text-white">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-200/90">Estimated level</p>
                    <p className="mt-1 text-5xl font-bold tracking-tight tabular-nums">{result.assessable && result.overallBand ? result.overallBand : '—'}</p>
                  </div>
                  <Button variant="outline" size="sm" className="flex-shrink-0 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setResult(null)}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Clear
                  </Button>
                </div>
                {result.summary && <p className="mt-4 text-sm leading-6 text-blue-50">{result.summary}</p>}
                <p className="mt-3 text-xs text-blue-100/80">
                  {result.criteriaSource === 'provided' ? 'Assessed against the criteria you pasted.' : `Assessed against the standard IB ${programme} criteria, because no rubric was pasted.`}
                </p>
              </Card>

              {result.criteria.map((c) => (
                <Card key={c.name} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold leading-snug">{c.name}</h2>
                    {c.band && <span className={cn('flex-shrink-0 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ring-1 ring-inset', bandTone(c.band))}>{c.band}</span>}
                  </div>
                  {c.evidence && <p className="mt-2 text-sm leading-6 text-muted-foreground">{c.evidence}</p>}
                  {c.strengths.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Working well</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {c.strengths.map((s) => (
                          <li key={s} className="flex items-start gap-2 text-sm leading-6">
                            <Check className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" /> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {c.improvements.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">To reach the next band</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {c.improvements.map((s) => (
                          <li key={s} className="flex items-start gap-2 text-sm leading-6">
                            <ArrowUpRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-amber-500" /> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              ))}

              {result.nextSteps.length > 0 && (
                <Card className="p-5">
                  <h2 className="font-semibold">Do these first</h2>
                  <ol className="mt-3 space-y-2.5">
                    {result.nextSteps.map((step, i) => (
                      <li key={step} className="flex items-start gap-3 text-sm leading-6">
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </Card>
              )}

              <p className="px-1 text-xs leading-5 text-muted-foreground">
                This is practice feedback from AI, not an official grade. Your teacher&rsquo;s mark may be different, and the AI can make mistakes. It won&rsquo;t write your work for you.{' '}
                {taskId !== NO_TASK && (
                  <Link href="/app/tasks" className="font-medium text-primary hover:underline">
                    Back to my tasks
                  </Link>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
