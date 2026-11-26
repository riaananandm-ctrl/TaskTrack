'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { EVIDENCE_TYPES, STRANDS, STRAND_LABEL, type Strand, uploadEvidence } from '@/lib/cas';

const STRAND_HINT: Record<Strand, string> = {
  creativity: 'Arts, design, music, writing, making things',
  activity: 'Sport, fitness, physical challenge',
  service: 'Helping others, unpaid, with a real need',
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CasLogPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [strands, setStrands] = useState<Strand[]>([]);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [hours, setHours] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [supervisorEmail, setSupervisorEmail] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fill the supervisor from the student's CAS profile, if they set one.
  useEffect(() => {
    if (!user) return;
    supabase
      .from('cas_profiles')
      .select('supervisor_name, supervisor_email')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.supervisor_name) setSupervisorName((v) => v || data.supervisor_name);
        if (data?.supervisor_email) setSupervisorEmail((v) => v || data.supervisor_email);
      });
  }, [user]);

  const toggle = (s: Strand) =>
    setStrands((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const h = Number(hours);
    if (!title.trim()) return setError('Give the experience a title.');
    if (!strands.length) return setError('Choose at least one strand.');
    if (!Number.isFinite(h) || h <= 0 || h > 1000) return setError('Enter the hours you spent, for example 2 or 1.5.');
    if (endDate && endDate < startDate) return setError('The end date cannot be before the start date.');
    if (supervisorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supervisorEmail.trim())) {
      return setError('That supervisor email does not look right.');
    }

    setBusy(true);
    setError(null);
    try {
      const evidence = file ? await uploadEvidence(user.id, file) : null;
      const { data, error: insertError } = await supabase
        .from('cas_experiences')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          strands,
          start_date: startDate,
          end_date: endDate || null,
          hours: Math.round(h * 100) / 100,
          supervisor_name: supervisorName.trim() || null,
          supervisor_email: supervisorEmail.trim() || null,
          evidence_url: evidence,
        })
        .select('id')
        .single();
      if (insertError || !data) throw new Error('The experience could not be saved. Please try again.');

      // A nudge to reflect while it is still fresh. Never blocks the save.
      await supabase
        .from('reminders')
        .insert({
          title: `Reflect on ${title.trim().slice(0, 80)}`,
          message: 'Write your CAS reflection while you still remember the details.',
          reminder_type: 'cas_reflection',
          scheduled_for: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
          repeat_rule: 'none',
          status: 'scheduled',
          is_enabled: true,
          is_read: false,
          dedupe_key: `cas_reflection:${data.id}`,
        })
        .then(({ error: reminderError }) => {
          if (reminderError) console.warn('CAS reflection reminder not saved');
        });

      router.push(`/app/cas/reflection/${data.id}?new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/app/cas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> CAS
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Log a CAS experience</h1>
      <p className="mt-1 text-sm text-muted-foreground">Takes about a minute. You can write the reflection straight after.</p>

      <Card className="mt-6 p-5 sm:p-6">
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="cas-title">What did you do?</Label>
            <Input id="cas-title" value={title} maxLength={200} placeholder="e.g. Beach clean-up at Juhu"
              onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Strands</legend>
            <p className="text-xs text-muted-foreground">Choose every strand it fits. Hours count toward each one.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {STRANDS.map((s) => (
                <button key={s} type="button" role="checkbox" aria-checked={strands.includes(s)} onClick={() => toggle(s)}
                  className={cn('rounded-xl border p-3 text-left transition-colors',
                    strands.includes(s) ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50')}>
                  <span className="block text-sm font-semibold">{STRAND_LABEL[s]}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{STRAND_HINT[s]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cas-start">Start date</Label>
              <Input id="cas-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cas-end">End date <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="cas-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cas-hours">Hours</Label>
              <Input id="cas-hours" type="number" inputMode="decimal" min="0.25" max="1000" step="0.25" value={hours}
                placeholder="2" onChange={(e) => setHours(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cas-desc">Details <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="cas-desc" rows={3} maxLength={5000} value={description}
              placeholder="Where, with whom, what your role was" onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cas-sup-name">Supervisor</Label>
              <Input id="cas-sup-name" value={supervisorName} maxLength={200} placeholder="Name"
                onChange={(e) => setSupervisorName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cas-sup-email">Supervisor email</Label>
              <Input id="cas-sup-email" type="email" value={supervisorEmail} maxLength={320} placeholder="They confirm it with one click"
                onChange={(e) => setSupervisorEmail(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cas-evidence">Evidence <span className="text-muted-foreground">(optional photo or PDF, up to 10 MB)</span></Label>
            <label htmlFor="cas-evidence"
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/40">
              <Paperclip className="h-4 w-4" />
              <span className="truncate">{file ? file.name : 'Add a photo or certificate'}</span>
            </label>
            <input id="cas-evidence" type="file" className="sr-only"
              accept={Object.keys(EVIDENCE_TYPES).map((e) => `.${e}`).join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save and write reflection
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Not now? We&rsquo;ll remind you to reflect in 48 hours.
          </p>
        </form>
      </Card>
    </div>
  );
}
