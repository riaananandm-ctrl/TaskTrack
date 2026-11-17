'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SUBJECT_COLORS } from '@/lib/types';
import { validateSubjectName, normalizeSubjectName } from '@/lib/subject-validation';
import { autoSortTasks } from '@/lib/ai-tools';
import { Check, Loader2, Plus, Sparkles } from 'lucide-react';

/** Common IB MYP / DP subjects, grouped. Students can add anything else. */
const GROUPS: { label: string; subjects: { name: string; icon: string }[] }[] = [
  {
    label: 'Languages',
    subjects: [
      { name: 'English', icon: 'BookOpen' },
      { name: 'Spanish', icon: 'Languages' },
      { name: 'French', icon: 'Languages' },
      { name: 'German', icon: 'Languages' },
      { name: 'Mandarin', icon: 'Languages' },
      { name: 'Hindi', icon: 'Languages' },
    ],
  },
  {
    label: 'Maths & Sciences',
    subjects: [
      { name: 'Mathematics', icon: 'Calculator' },
      { name: 'Science', icon: 'FlaskConical' },
      { name: 'Biology', icon: 'Microscope' },
      { name: 'Chemistry', icon: 'FlaskConical' },
      { name: 'Physics', icon: 'FlaskConical' },
      { name: 'Computer Science', icon: 'Code' },
    ],
  },
  {
    label: 'Individuals & Societies',
    subjects: [
      { name: 'Individuals & Societies', icon: 'Globe' },
      { name: 'History', icon: 'Library' },
      { name: 'Geography', icon: 'Globe' },
      { name: 'Economics', icon: 'Brain' },
      { name: 'Business Management', icon: 'Brain' },
      { name: 'Psychology', icon: 'Brain' },
    ],
  },
  {
    label: 'Arts, Design & PHE',
    subjects: [
      { name: 'Music', icon: 'Music' },
      { name: 'Visual Arts', icon: 'Palette' },
      { name: 'Drama', icon: 'Camera' },
      { name: 'Design', icon: 'Ruler' },
      { name: 'Physical & Health Education', icon: 'Dumbbell' },
      { name: 'Theory of Knowledge', icon: 'Brain' },
    ],
  },
];
const ICON_BY_NAME = new Map(GROUPS.flatMap((g) => g.subjects.map((s) => [s.name.toLowerCase(), s.icon] as const)));

export interface SubjectPickerResult { created: number; sorted: number }

/**
 * Lets a student pick their subjects from a list (or type their own), saves any new
 * ones, then uses TaskTrack AI to sort their unsorted tasks into those subjects based
 * on each task's title and description.
 */
export function SubjectPicker({ onDone, compact }: { onDone?: (result: SubjectPickerResult) => void; compact?: boolean }) {
  const { user } = useAuth();
  const [existing, setExisting] = useState<{ name: string; colour: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'sorting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('subjects')
      .select('name, colour')
      .eq('is_archived', false)
      .then(({ data }) => {
        setExisting((data as { name: string; colour: string }[]) ?? []);
        setLoading(false);
      });
  }, [user]);

  const existingLower = useMemo(() => new Set(existing.map((s) => s.name.trim().toLowerCase())), [existing]);
  const isOn = (name: string) => existingLower.has(name.toLowerCase()) || chosen.some((c) => c.toLowerCase() === name.toLowerCase());
  const customChosen = chosen.filter((c) => !ICON_BY_NAME.has(c.toLowerCase()));

  const toggle = (name: string) => {
    if (existingLower.has(name.toLowerCase())) return; // already saved: manage it on the Subjects page
    setResult(null);
    setChosen((prev) => (prev.some((c) => c.toLowerCase() === name.toLowerCase()) ? prev.filter((c) => c.toLowerCase() !== name.toLowerCase()) : [...prev, name]));
  };

  const addCustom = () => {
    const check = validateSubjectName(custom);
    if (!check.ok) { setCustomError(check.error); return; }
    const name = normalizeSubjectName(custom);
    if (!isOn(name)) setChosen((prev) => [...prev, name]);
    setCustom('');
    setCustomError(null);
  };

  const save = async () => {
    if (!user) return;
    setError(null);
    setResult(null);
    setSaving('saving');
    const used = new Set(existing.map((s) => s.colour));
    const free = SUBJECT_COLORS.filter((c) => !used.has(c));
    const rows = chosen.map((name, i) => ({
      user_id: user.id,
      name,
      colour: free[i % Math.max(free.length, 1)] ?? SUBJECT_COLORS[(existing.length + i) % SUBJECT_COLORS.length],
      icon: ICON_BY_NAME.get(name.toLowerCase()) ?? 'BookOpen',
    }));
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('subjects').insert(rows);
      if (insertError) {
        setSaving('idle');
        setError('Couldn’t save your subjects. Check the names and try again.');
        return;
      }
    }
    setExisting((prev) => [...prev, ...rows.map((r) => ({ name: r.name, colour: r.colour }))]);
    setChosen([]);

    setSaving('sorting');
    let sorted = 0;
    try {
      sorted = (await autoSortTasks({ all: true })).subjected;
    } catch {
      // Sorting is a convenience; the subjects are saved either way.
    }
    setSaving('idle');
    setResult(
      sorted > 0
        ? `Saved. TaskTrack AI sorted ${sorted} task${sorted === 1 ? '' : 's'} into your subjects.`
        : 'Saved. New tasks you add or import will be sorted into these subjects automatically.',
    );
    onDone?.({ created: rows.length, sorted });
  };

  if (loading) return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const total = existing.length + chosen.length;

  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
          <div className="flex flex-wrap gap-2">
            {group.subjects.map((s) => {
              const on = isOn(s.name);
              const saved = existingLower.has(s.name.toLowerCase());
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => toggle(s.name)}
                  aria-pressed={on}
                  disabled={saved}
                  title={saved ? 'Already in your subjects' : undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors',
                    on ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent',
                    saved && 'opacity-80 cursor-default',
                  )}
                >
                  {on && <Check className="w-3.5 h-3.5" />}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Something else?</p>
        {(customChosen.length > 0 || existing.some((e) => !ICON_BY_NAME.has(e.name.toLowerCase()))) && (
          <div className="flex flex-wrap gap-2">
            {existing.filter((e) => !ICON_BY_NAME.has(e.name.toLowerCase())).map((e) => (
              <span key={e.name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-primary text-primary-foreground opacity-80">
                <Check className="w-3.5 h-3.5" />{e.name}
              </span>
            ))}
            {customChosen.map((c) => (
              <button key={c} type="button" onClick={() => toggle(c)} aria-pressed className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-primary text-primary-foreground">
                <Check className="w-3.5 h-3.5" />{c}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 max-w-md">
          <Input
            value={custom}
            onChange={(e) => { setCustom(e.target.value); setCustomError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            placeholder="e.g. Sanskrit, Global Politics"
            aria-label="Add another subject"
            maxLength={60}
          />
          <Button type="button" variant="outline" onClick={addCustom} disabled={!custom.trim()}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
        {customError && <p className="text-xs text-red-600">{customError}</p>}
      </div>

      <div className={cn('flex flex-wrap items-center gap-3', !compact && 'pt-2 border-t border-border')}>
        <Button onClick={save} disabled={saving !== 'idle' || chosen.length === 0 && existing.length === 0}>
          {saving === 'idle' ? <Sparkles className="w-4 h-4 mr-2" /> : <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {saving === 'saving' ? 'Saving subjects…' : saving === 'sorting' ? 'Sorting your tasks…' : chosen.length > 0 ? `Save ${chosen.length} subject${chosen.length === 1 ? '' : 's'} & sort my tasks` : 'Sort my tasks into subjects'}
        </Button>
        <span className="text-xs text-muted-foreground">{total} subject{total === 1 ? '' : 's'} selected</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && <p className="text-sm text-emerald-700 dark:text-emerald-400">{result}</p>}
      <p className="text-xs text-muted-foreground">
        TaskTrack AI reads each task’s title and description to pick a subject. It never changes a subject you set yourself, and you can always change it.
      </p>
    </div>
  );
}
