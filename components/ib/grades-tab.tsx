'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2, Target, Award, TrendingUp, TrendingDown, Minus, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CRITERIA, dpTotal, focusTip, gradeOf, honourRoll, HONOUR_LABEL, HONOUR_LEVELS, HONOUR_SUBJECTS, summarise,
  type Criterion, type GradeEntry, type Programme, type SubjectSummary,
} from '@/lib/ib-grades';
import { addGrades, deleteGrade, listGrades, localToday } from '@/lib/ib-data';

const PROGRAMME_KEY = 'tasktrack.ib.programme';

/** The last programme the student picked, or a guess from their year group. */
function readProgramme(fallback: Programme): Programme {
  try {
    const saved = window.localStorage.getItem(PROGRAMME_KEY);
    if (saved === 'DP' || saved === 'MYP') return saved;
  } catch {
    // storage blocked: use the fallback
  }
  return fallback;
}

export function GradesTab({ subjectNames, defaultProgramme = 'MYP' }: { subjectNames: string[]; defaultProgramme?: Programme }) {
  const [grades, setGrades] = useState<GradeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setGrades(await listGrades());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your grades could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summaries = useMemo(() => summarise(grades), [grades]);
  const tip = focusTip(summaries);
  const total = dpTotal(summaries);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          Add your marks after each assessment. You&rsquo;ll see a predicted grade per subject and the one thing to work on
          next. Predictions come from your own marks, so treat them as a guide.
        </p>
        <Button onClick={() => setAdding(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Add marks
        </Button>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />
      ) : summaries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <Target className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold">No marks yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            MYP: enter your criterion marks (A&ndash;D, out of 8). DP: enter your grade (1&ndash;7) for each test or task.
          </p>
          <Button onClick={() => setAdding(true)} className="mt-4 gap-2">
            <Plus className="w-4 h-4" /> Add your first marks
          </Button>
        </div>
      ) : (
        <>
          {tip && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex gap-3 items-start">
              <Target className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Work on this next</p>
                <p className="text-sm text-muted-foreground mt-0.5">{tip}</p>
              </div>
            </div>
          )}
          <HonourRollCard summaries={summaries} />
          {total !== null && (
            <p className="text-sm">
              Predicted DP total from your six subjects: <span className="font-semibold">{total}/42</span>{' '}
              <span className="text-muted-foreground">(plus up to 3 core points from TOK and the EE)</span>
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((s) => (
              <SubjectCard
                key={`${s.programme}:${s.subject}`}
                summary={s}
                entries={grades.filter(
                  (g) => g.programme === s.programme && g.subject_name.trim().toLowerCase() === s.subject.toLowerCase(),
                )}
                onChanged={load}
              />
            ))}
          </div>
        </>
      )}

      <AddMarksDialog open={adding} onClose={() => setAdding(false)} onSaved={load} subjectNames={subjectNames} defaultProgramme={defaultProgramme} />
    </div>
  );
}

/** MYP honour roll from the predicted grade in each of the 8 subjects. */
function HonourRollCard({ summaries }: { summaries: SubjectSummary[] }) {
  const myp = summaries.filter((s) => s.programme === 'MYP' && gradeOf(s) > 0);
  if (!myp.length) return null;
  // Best 8 if a student has logged more subjects than the honour roll counts.
  const grades = myp.map(gradeOf).sort((a, b) => b - a);
  const r = honourRoll(grades);
  const complete = r.counted === HONOUR_SUBJECTS;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', r.award ? 'bg-amber-500/15 text-amber-600' : 'bg-muted text-muted-foreground')}>
          <Award className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {!complete
              ? `Honour roll: ${r.counted} of ${HONOUR_SUBJECTS} subjects added`
              : r.award
                ? `On track for the ${HONOUR_LABEL[r.award]}`
                : 'Not on the honour roll yet'}
          </p>
          <p className="text-xs text-muted-foreground">
            {complete
              ? `Total ${r.total}/56 from your 8 subjects · lowest grade ${r.lowest}`
              : `Add marks for all ${HONOUR_SUBJECTS} subjects to see your honour roll. Total so far: ${r.total}.`}
          </p>
        </div>
      </div>

      {complete && (r.note || r.next) && (
        <div className="mt-3 space-y-1 text-sm">
          {r.note && <p className="text-amber-700 dark:text-amber-400">{r.note}</p>}
          {r.next && (
            <p className="text-muted-foreground">
              {r.next.points} more point{r.next.points === 1 ? '' : 's'} for the {HONOUR_LABEL[r.next.award]}.
            </p>
          )}
        </div>
      )}
      {myp.length > HONOUR_SUBJECTS && (
        <p className="mt-2 text-xs text-muted-foreground">You have {myp.length} subjects; your best {HONOUR_SUBJECTS} are counted.</p>
      )}

      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">How it works</summary>
        <ul className="mt-2 space-y-1">
          {HONOUR_LEVELS.map((l) => (
            <li key={l.award}>
              <span className="font-medium text-foreground">{HONOUR_LABEL[l.award]}</span>: {l.total}+ points, every grade {l.minGrade} or above
            </li>
          ))}
          <li>Any grade below 4 means no honour roll. Based on your predicted grades, so it&rsquo;s a guide.</li>
        </ul>
      </details>
    </div>
  );
}

function GradeBadge({ grade }: { grade: number }) {
  return (
    <div
      className={cn(
        'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-2xl font-bold',
        grade >= 6 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : grade >= 4 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : 'bg-red-500/15 text-red-600 dark:text-red-400',
      )}
      aria-label={`Grade ${grade}`}
    >
      {grade || '–'}
    </div>
  );
}

function SubjectCard({ summary, entries, onChanged }: { summary: SubjectSummary; entries: GradeEntry[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const grade = summary.programme === 'MYP' ? summary.grade : summary.predicted;

  const remove = async (id: string) => {
    try {
      await deleteGrade(id);
      onChanged();
    } catch {
      // keep the row if it couldn't be deleted
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <GradeBadge grade={grade} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{summary.subject}</p>
          <p className="text-xs text-muted-foreground">
            {summary.programme === 'MYP' ? (
              <>MYP &middot; {summary.total}/32{summary.estimated && ' (estimate: some criteria have no marks yet)'}</>
            ) : (
              <>DP{summary.level ? ` ${summary.level}` : ''} &middot; predicted from your last {Math.min(summary.count, 3)} grade{summary.count === 1 ? '' : 's'}</>
            )}
          </p>
        </div>
        {summary.programme === 'DP' && (
          <span className="text-muted-foreground" title={`Latest grade ${summary.latest}`}>
            {summary.trend === 'up' ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : summary.trend === 'down' ? <TrendingDown className="w-4 h-4 text-red-500" /> : <Minus className="w-4 h-4" />}
          </span>
        )}
      </div>

      {summary.programme === 'MYP' && (
        <div className="space-y-1.5">
          {CRITERIA.map((c) => {
            const v = summary.criteria[c];
            const weakest = summary.weakest === c;
            return (
              <div key={c} className="flex items-center gap-2 text-xs">
                <span className={cn('w-4 font-semibold', weakest && 'text-primary')}>{c}</span>
                <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                  {v !== null && (
                    <div className={cn('h-full rounded-full', weakest ? 'bg-primary' : 'bg-slate-400 dark:bg-slate-500')} style={{ width: `${(v / 8) * 100}%` }} />
                  )}
                </div>
                <span className="w-16 text-right text-muted-foreground">
                  {v === null ? 'no marks' : `${v}/8`}
                  {weakest && ' ←'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={open}>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        {entries.length} mark{entries.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ul className="divide-y divide-border rounded-lg border border-border text-xs">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-14 text-muted-foreground">{format(parseISO(e.assessed_on), 'd MMM yy')}</span>
              <span className="flex-1 truncate">{e.assessment || (e.criterion ? `Criterion ${e.criterion}` : 'Grade')}</span>
              <span className="font-medium">{e.criterion ? `${e.criterion}: ${e.mark}/8` : e.mark}</span>
              <button onClick={() => remove(e.id)} aria-label="Delete this mark" className="tap-target p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddMarksDialog({
  open, onClose, onSaved, subjectNames, defaultProgramme,
}: { open: boolean; onClose: () => void; onSaved: () => void; subjectNames: string[]; defaultProgramme: Programme }) {
  const [programme, setProgramme] = useState<Programme>('MYP');
  const [subject, setSubject] = useState('');
  const [assessment, setAssessment] = useState('');
  const [date, setDate] = useState(localToday());
  const [level, setLevel] = useState<'SL' | 'HL'>('SL');
  const [myp, setMyp] = useState<Record<Criterion, string>>({ A: '', B: '', C: '', D: '' });
  const [dp, setDp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProgramme(readProgramme(defaultProgramme));
      setAssessment('');
      setMyp({ A: '', B: '', C: '', D: '' });
      setDp('');
      setDate(localToday());
      setError(null);
    }
  }, [open, defaultProgramme]);

  const chooseProgramme = (p: Programme) => {
    setProgramme(p);
    try {
      window.localStorage.setItem(PROGRAMME_KEY, p);
    } catch {
      // not saved; fine
    }
  };

  const save = async () => {
    setError(null);
    if (!subject.trim()) return setError('Add the subject.');
    let marks: { criterion: Criterion | null; mark: number }[] = [];
    if (programme === 'MYP') {
      for (const c of CRITERIA) {
        const raw = myp[c].trim();
        if (!raw) continue;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 8) return setError(`Criterion ${c} must be a whole number from 0 to 8.`);
        marks.push({ criterion: c, mark: n });
      }
      if (!marks.length) return setError('Enter at least one criterion mark.');
    } else {
      const n = Number(dp);
      if (!dp || !Number.isInteger(n) || n < 1 || n > 7) return setError('Choose a grade from 1 to 7.');
      marks = [{ criterion: null, mark: n }];
    }
    setSaving(true);
    try {
      await addGrades({ subject_name: subject, programme, level: programme === 'DP' ? level : null, assessment, assessed_on: date, marks });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those marks could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add marks</DialogTitle>
          <DialogDescription>From a test, task or report.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Programme">
            {(['MYP', 'DP'] as Programme[]).map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={programme === p}
                onClick={() => chooseProgramme(p)}
                className={cn('rounded-lg border px-3 py-2 text-sm font-medium', programme === p ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent')}
              >
                {p === 'MYP' ? 'MYP (criteria A–D)' : 'DP (grades 1–7)'}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ib-subject">Subject</Label>
            <Input id="ib-subject" list="ib-subject-list" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={60} placeholder="e.g. Sciences" />
            <datalist id="ib-subject-list">
              {subjectNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="ib-assessment">Assessment (optional)</Label>
              <Input id="ib-assessment" value={assessment} onChange={(e) => setAssessment(e.target.value)} maxLength={120} placeholder="e.g. Unit 3 test" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ib-date">Date</Label>
              <Input id="ib-date" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value || localToday())} />
            </div>
          </div>
          {programme === 'MYP' ? (
            <div className="space-y-1.5">
              <Label>Marks out of 8 (leave blank if not assessed)</Label>
              <div className="grid grid-cols-4 gap-2">
                {CRITERIA.map((c) => (
                  <div key={c} className="space-y-1">
                    <span className="block text-center text-xs font-semibold">{c}</span>
                    <Input
                      inputMode="numeric"
                      aria-label={`Criterion ${c} mark`}
                      value={myp[c]}
                      onChange={(e) => setMyp((m) => ({ ...m, [c]: e.target.value.replace(/[^0-9]/g, '').slice(0, 1) }))}
                      className="text-center"
                      placeholder="–"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Level</Label>
                <Select value={level} onValueChange={(v) => setLevel(v as 'SL' | 'HL')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SL">SL</SelectItem>
                    <SelectItem value="HL">HL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Grade</Label>
                <Select value={dp} onValueChange={setDp}>
                  <SelectTrigger><SelectValue placeholder="1–7" /></SelectTrigger>
                  <SelectContent>
                    {[7, 6, 5, 4, 3, 2, 1].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save marks'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
