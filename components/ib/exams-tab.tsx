'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { Plus, Trash2, CalendarClock, Loader2, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { daysBetween } from '@/lib/revision-plan';
import {
  addExams, deleteExam, ensurePlanCurrent, listExams, listRevisionSessions, localToday, rebuildRevisionPlan, setSessionDone,
  type Exam, type RevisionSession,
} from '@/lib/ib-data';

const PER_DAY_KEY = 'tasktrack.ib.perDay';
const KIND_LABEL: Record<Exam['kind'], string> = { mock: 'Mock', final: 'Final', test: 'Test', summative: 'Summative' };

function readPerDay(): number {
  try {
    const n = Number(window.localStorage.getItem(PER_DAY_KEY));
    return n >= 1 && n <= 4 ? n : 3;
  } catch {
    return 3;
  }
}

export function countdownLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days} days`;
}

export function ExamsTab({ subjectNames, onChanged }: { subjectNames: string[]; onChanged?: () => void }) {
  // Lets the IB Hub summary strip refresh when exams or sessions change.
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [exams, setExams] = useState<Exam[]>([]);
  const [sessions, setSessions] = useState<RevisionSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [perDay, setPerDay] = useState(3);
  const [replanning, setReplanning] = useState(false);
  const today = localToday();

  const load = useCallback(async () => {
    try {
      const e = await listExams();
      // Summatives and urgent tasks arrive as exams on their own; plan for any new ones.
      await ensurePlanCurrent(e, readPerDay()).catch(() => false);
      const s = await listRevisionSessions();
      setExams(e);
      setSessions(s);
      setError(null);
      changed.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your exams could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPerDay(readPerDay());
    load();
  }, [load]);

  const upcoming = exams.filter((e) => e.exam_date >= today);
  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams]);
  const horizon = showAll ? '9999-12-31' : format(new Date(Date.now() + 13 * 86_400_000), 'yyyy-MM-dd');
  const visible = sessions.filter((s) => s.session_date <= horizon);
  const byDay = useMemo(() => {
    const m = new Map<string, RevisionSession[]>();
    for (const s of visible) m.set(s.session_date, [...(m.get(s.session_date) ?? []), s]);
    return Array.from(m.entries());
  }, [visible]);

  const changePerDay = async (v: string) => {
    const n = Number(v);
    setPerDay(n);
    try {
      window.localStorage.setItem(PER_DAY_KEY, v);
    } catch {
      // fine
    }
    setReplanning(true);
    try {
      await rebuildRevisionPlan(n);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your plan could not be updated.');
    } finally {
      setReplanning(false);
    }
  };

  const toggle = async (s: RevisionSession) => {
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, done: !s.done } : x)));
    try {
      await setSessionDone(s.id, !s.done);
      changed.current?.();
    } catch {
      setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, done: s.done } : x)));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteExam(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That exam could not be deleted.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          Every summative and urgent task shows here as an exam automatically. Add mocks and finals too. TaskTrack plans
          revision backwards from each one, spacing topics out so they stick, and ends with a timed past paper.
        </p>
        <Button onClick={() => setAdding(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Add exam
        </Button>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />
      ) : upcoming.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <CalendarClock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold">No exams yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Summatives and urgent tasks appear here on their own. You can also add an exam yourself.</p>
          <Button onClick={() => setAdding(true)} className="mt-4 gap-2"><Plus className="w-4 h-4" /> Add your first exam</Button>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((e) => {
              const days = daysBetween(today, e.exam_date);
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className={cn('flex h-12 w-12 flex-shrink-0 flex-col items-center justify-center rounded-xl', days <= 7 ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-primary/10 text-primary')}>
                    <span className="text-lg font-bold leading-none">{days}</span>
                    <span className="text-[10px] leading-none mt-0.5">{days === 1 ? 'day' : 'days'}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{e.subject_name}{e.paper ? ` · ${e.paper}` : ''}</p>
                    <p className="text-xs text-muted-foreground">{KIND_LABEL[e.kind]} &middot; {format(parseISO(e.exam_date), 'EEE d MMM')} &middot; {countdownLabel(days)}</p>
                  </div>
                  {e.task_id ? (
                    <Link href={`/app/tasks/${e.task_id}`} aria-label={`Open the ${e.subject_name} task`} title="From your tasks. Complete the task to remove it." className="tap-target p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  ) : (
                    <button onClick={() => remove(e.id)} aria-label={`Delete ${e.subject_name} exam`} className="tap-target p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="font-semibold">Revision timetable</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {replanning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Max per day</span>
                <Select value={String(perDay)} onValueChange={changePerDay}>
                  <SelectTrigger className="h-8 w-16" aria-label="Maximum sessions per day"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {byDay.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Nothing planned in the next two weeks.</p>
            ) : (
              <ul className="divide-y divide-border">
                {byDay.map(([day, list]) => (
                  <li key={day} className="px-4 py-3">
                    <p className={cn('text-xs font-semibold mb-1.5', day === today ? 'text-primary' : 'text-muted-foreground')}>
                      {day === today ? 'Today' : format(parseISO(day), 'EEEE d MMM')}
                    </p>
                    <ul className="space-y-1.5">
                      {list.map((s) => (
                        <li key={s.id} className="flex items-start gap-2.5">
                          <button
                            onClick={() => toggle(s)}
                            role="checkbox"
                            aria-checked={s.done}
                            aria-label={`Mark "${s.focus}" as ${s.done ? 'not done' : 'done'}`}
                            className={cn('tap-target mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border', s.done ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}
                          >
                            {s.done && <Check className="w-3.5 h-3.5" />}
                          </button>
                          <div className="min-w-0">
                            <p className={cn('text-sm', s.done && 'line-through text-muted-foreground')}>{s.focus}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.minutes} min{examById.get(s.exam_id) ? ` · ${KIND_LABEL[examById.get(s.exam_id)!.kind].toLowerCase()} on ${format(parseISO(examById.get(s.exam_id)!.exam_date), 'd MMM')}` : ''}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {sessions.length > visible.length || showAll ? (
              <button onClick={() => setShowAll((v) => !v)} className="w-full border-t border-border px-4 py-2.5 text-sm text-primary hover:bg-accent/50">
                {showAll ? 'Show the next two weeks only' : `Show all ${sessions.length} sessions`}
              </button>
            ) : null}
          </div>
        </>
      )}

      <AddExamDialog open={adding} onClose={() => setAdding(false)} onSaved={load} subjectNames={subjectNames} />
    </div>
  );
}

function AddExamDialog({ open, onClose, onSaved, subjectNames }: { open: boolean; onClose: () => void; onSaved: () => void; subjectNames: string[] }) {
  const [subject, setSubject] = useState('');
  const [paper, setPaper] = useState('');
  const [kind, setKind] = useState<Exam['kind']>('mock');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPaper('');
      setDate('');
      setError(null);
    }
  }, [open]);

  const save = async () => {
    setError(null);
    if (!subject.trim()) return setError('Add the subject.');
    if (!date || date <= localToday()) return setError('Choose a date after today.');
    setSaving(true);
    try {
      await addExams([{ subject_name: subject, paper, kind, exam_date: date }]);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That exam could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add exam</DialogTitle>
          <DialogDescription>Your revision timetable updates straight away.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="exam-subject">Subject</Label>
            <Input id="exam-subject" list="exam-subject-list" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={60} placeholder="e.g. Chemistry" />
            <datalist id="exam-subject-list">
              {subjectNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="exam-paper">Paper (optional)</Label>
              <Input id="exam-paper" value={paper} onChange={(e) => setPaper(e.target.value)} maxLength={60} placeholder="e.g. Paper 1" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Exam['kind'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mock">Mock exam</SelectItem>
                  <SelectItem value="final">Final exam</SelectItem>
                  <SelectItem value="test">Class test</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exam-date">Date</Label>
            <Input id="exam-date" type="date" value={date} min={localToday()} onChange={(e) => setDate(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Planning…' : 'Add and plan'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
