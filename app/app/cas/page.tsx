'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle2, Circle, Loader2, Plus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import {
  CAS_OUTCOMES,
  STRANDS,
  STRAND_LABEL,
  type CasExperience,
  type CasProfile,
  type CasReflection,
  daysUntil,
  evidencedOutcomes,
  hoursByStrand,
  strandsAtRisk,
  targetsOf,
  totalHours,
} from '@/lib/cas';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  queried: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
};

export default function CasDashboardPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<CasProfile | null>(null);
  const [experiences, setExperiences] = useState<CasExperience[]>([]);
  const [reflections, setReflections] = useState<Pick<CasReflection, 'experience_id' | 'outcomes'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const [p, e, r] = await Promise.all([
      supabase.from('cas_profiles').select('*').maybeSingle(),
      supabase.from('cas_experiences').select('*').order('start_date', { ascending: false }),
      supabase.from('cas_reflections').select('experience_id, outcomes'),
    ]);
    setProfile((p.data as CasProfile | null) ?? null);
    setExperiences((e.data as CasExperience[] | null) ?? []);
    setReflections((r.data as Pick<CasReflection, 'experience_id' | 'outcomes'>[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const totals = useMemo(() => hoursByStrand(experiences), [experiences]);
  const targets = targetsOf(profile);
  const evidenced = useMemo(() => evidencedOutcomes(reflections), [reflections]);
  const atRisk = strandsAtRisk(totals, targets, profile?.end_date ?? null);
  const reflected = new Set(reflections.map((r) => r.experience_id));
  const unreflected = experiences.filter((e) => !reflected.has(e.id));

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">CAS</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Creativity, Activity, Service</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalHours(experiences)} hours across {experiences.length} experience{experiences.length === 1 ? '' : 's'}
            {profile?.end_date && ` · CAS ends ${format(parseISO(profile.end_date), 'd MMM yyyy')}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            <Settings2 className="mr-1.5 h-4 w-4" /> CAS settings
          </Button>
          <Button asChild>
            <Link href="/app/cas/log"><Plus className="mr-1.5 h-4 w-4" /> Log experience</Link>
          </Button>
        </div>
      </div>

      {(editing || !profile) && (
        <ProfileForm profile={profile} onSaved={() => { setEditing(false); load(); }} onCancel={profile ? () => setEditing(false) : undefined} />
      )}

      {atRisk.length > 0 && profile?.end_date && (
        <div role="alert" className="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold">{atRisk.map((s) => STRAND_LABEL[s]).join(' and ')} {atRisk.length === 1 ? 'is' : 'are'} under half your target</span>
            {' '}and CAS ends in {Math.max(0, daysUntil(profile.end_date))} days. Plan a few experiences for {atRisk.length === 1 ? 'it' : 'them'} soon.
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {STRANDS.map((s) => {
          const pct = targets[s] > 0 ? Math.min(100, (totals[s] / targets[s]) * 100) : 0;
          return (
            <Card key={s} className="p-4">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{STRAND_LABEL[s]}</p>
                <p className="text-sm tabular-nums text-muted-foreground">{totals[s]} / {targets[s]} h</p>
              </div>
              <Progress value={pct} className="mt-3 h-2" aria-label={`${STRAND_LABEL[s]} ${Math.round(pct)}% of target`} />
            </Card>
          );
        })}
      </div>

      <Card className="mt-4 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Learning outcomes</h2>
          <span className="text-sm text-muted-foreground">{evidenced.size} of 7 evidenced</span>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {CAS_OUTCOMES.map((o) => {
            const done = evidenced.has(o.id);
            return (
              <li key={o.id} className="flex items-start gap-2 text-sm">
                {done
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Evidenced" />
                  : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-label="Not yet" />}
                <span className={done ? '' : 'text-muted-foreground'}>{o.id}. {o.full}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {unreflected.length > 0 && (
        <Card className="mt-4 p-4 text-sm">
          <span className="font-medium">{unreflected.length} experience{unreflected.length === 1 ? ' needs' : 's need'} a reflection.</span>{' '}
          <Link href={`/app/cas/reflection/${unreflected[0].id}`} className="text-primary underline-offset-2 hover:underline">
            Reflect on {unreflected[0].title}
          </Link>
        </Card>
      )}

      <h2 className="mt-8 font-semibold">Experiences</h2>
      {experiences.length === 0 ? (
        <Card className="mt-3 p-8 text-center text-sm text-muted-foreground">
          Nothing logged yet. Your first experience takes about a minute.
          <div className="mt-4"><Button asChild><Link href="/app/cas/log">Log experience</Link></Button></div>
        </Card>
      ) : (
        <Card className="mt-3 divide-y">
          {experiences.map((e) => (
            <Link key={e.id} href={`/app/cas/experience/${e.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {format(parseISO(e.start_date), 'd MMM yyyy')} · {e.strands.map((s) => STRAND_LABEL[s]).join(' + ')} · {Number(e.hours)} h
                </p>
              </div>
              {!reflected.has(e.id) && <Badge variant="outline" className="text-xs">No reflection</Badge>}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[e.verification_status]}`}>
                {e.verification_status}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

function ProfileForm({ profile, onSaved, onCancel }: { profile: CasProfile | null; onSaved: () => void; onCancel?: () => void }) {
  const [startDate, setStartDate] = useState(profile?.start_date ?? '');
  const [endDate, setEndDate] = useState(profile?.end_date ?? '');
  const [name, setName] = useState(profile?.supervisor_name ?? '');
  const [email, setEmail] = useState(profile?.supervisor_email ?? '');
  const [t, setT] = useState({
    creativity: String(profile?.target_hours_creativity ?? 50),
    activity: String(profile?.target_hours_activity ?? 50),
    service: String(profile?.target_hours_service ?? 50),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const nums = STRANDS.map((s) => Number(t[s]));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) return setError('Targets are whole hours between 0 and 1000.');
    if (startDate && endDate && endDate < startDate) return setError('The end date cannot be before the start date.');
    setBusy(true);
    setError(null);
    const { error: saveError } = await supabase.from('cas_profiles').upsert(
      {
        ...(profile ? { id: profile.id } : {}),
        start_date: startDate || null,
        end_date: endDate || null,
        supervisor_name: name.trim() || null,
        supervisor_email: email.trim() || null,
        target_hours_creativity: nums[0],
        target_hours_activity: nums[1],
        target_hours_service: nums[2],
      },
      { onConflict: 'user_id' },
    );
    setBusy(false);
    if (saveError) return setError('Your CAS settings could not be saved. Please try again.');
    onSaved();
  };

  return (
    <Card className="mt-6 p-5">
      <h2 className="font-semibold">{profile ? 'CAS settings' : 'Set up CAS'}</h2>
      <p className="text-sm text-muted-foreground">Your CAS dates and hour targets. Ask your coordinator if you are not sure.</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="cp-start">CAS start</Label>
            <Input id="cp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="cp-end">CAS end</Label>
            <Input id="cp-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {STRANDS.map((s) => (
            <div key={s} className="space-y-1.5"><Label htmlFor={`cp-${s}`}>{STRAND_LABEL[s]} hours</Label>
              <Input id={`cp-${s}`} type="number" min="0" max="1000" value={t[s]} onChange={(e) => setT((p) => ({ ...p, [s]: e.target.value }))} /></div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="cp-sup">CAS supervisor</Label>
            <Input id="cp-sup" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="cp-sup-email">Supervisor email</Label>
            <Input id="cp-sup-email" type="email" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
        </div>
      </form>
    </Card>
  );
}
