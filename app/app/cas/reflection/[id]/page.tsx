'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Loader2, MessageCircleQuestion, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  CAS_OUTCOMES,
  STRAND_LABEL,
  type CasExperience,
  type CasReflection,
  type OutcomeSuggestion,
  type VagueFlag,
  coachQuestions,
  findVague,
  localVagueFlags,
  mergeFlags,
  suggestOutcomes,
} from '@/lib/cas';

type Fields = { what_i_did: string; what_i_learned: string; outcome_evidence: string };

const FIELD_META: { key: keyof Fields; label: string; hint: string }[] = [
  { key: 'what_i_did', label: 'What I did', hint: 'The facts: where, when, your role, one moment you remember.' },
  { key: 'what_i_learned', label: 'What I learned', hint: 'Something that changed: a skill, a view, how you work with people.' },
  { key: 'outcome_evidence', label: 'Which outcome, and how', hint: 'Name the outcome and point to what shows it.' },
];

export default function CasReflectionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = useSearchParams().get('new') === '1';
  const [experience, setExperience] = useState<CasExperience | null>(null);
  const [fields, setFields] = useState<Fields>({ what_i_did: '', what_i_learned: '', outcome_evidence: '' });
  const [outcomes, setOutcomes] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI outcome mapper. Hidden for the rest of the visit if it fails.
  const [aiAvailable, setAiAvailable] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<OutcomeSuggestion[]>([]);

  // Feedback: coach questions and vague-sentence flags. Questions only, never text.
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const [aiFlags, setAiFlags] = useState<VagueFlag[]>([]);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    const [{ data: exp }, { data: ref }] = await Promise.all([
      supabase.from('cas_experiences').select('*').eq('id', id).maybeSingle(),
      supabase.from('cas_reflections').select('*').eq('experience_id', id).maybeSingle(),
    ]);
    if (!exp) {
      setMissing(true);
    } else {
      setExperience(exp as CasExperience);
      const r = ref as CasReflection | null;
      if (r) {
        setFields({
          what_i_did: r.what_i_did ?? '',
          what_i_learned: r.what_i_learned ?? '',
          outcome_evidence: r.outcome_evidence ?? '',
        });
        setOutcomes(r.outcomes ?? []);
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const words = Object.values(fields).join(' ').split(/\s+/).filter(Boolean).length;

  // Stock phrases are flagged as the student types; AI flags only while the sentence is still there.
  const flags = useMemo(() => {
    const flat = Object.values(fields).join(' ').replace(/\s+/g, ' ').toLowerCase();
    const stillThere = aiFlags.filter((f) => flat.includes(f.sentence.toLowerCase().replace(/[.!?]+$/, '')));
    return mergeFlags(localVagueFlags(fields), stillThere);
  }, [fields, aiFlags]);

  const askFeedback = async () => {
    if (!experience) return;
    setFeedbackBusy(true);
    setAiNote(null);
    const [coach, vague] = await Promise.all([
      coachQuestions(fields, experience.title, experience.strands),
      findVague(fields),
    ]);
    setFeedbackBusy(false);
    const limited = [coach, vague].find((r) => !r.ok && (r.code === 'DAILY_LIMIT' || r.code === 'TOO_SHORT'));
    if (limited && !limited.ok) {
      setAiNote(limited.message);
      return;
    }
    if (!coach.ok && !vague.ok) {
      setAiAvailable(false);
      return;
    }
    setQuestions(coach.ok ? coach.data.questions : []);
    setAiFlags(vague.ok ? vague.data.flags : []);
    setChecked(true);
  };

  const toggleOutcome = (n: number) =>
    setOutcomes((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort()));

  const askOutcomes = async () => {
    setAiBusy(true);
    setAiNote(null);
    const res = await suggestOutcomes(fields);
    setAiBusy(false);
    if (!res.ok) {
      if (res.code === 'TOO_SHORT' || res.code === 'DAILY_LIMIT') setAiNote(res.message);
      else setAiAvailable(false);
      return;
    }
    const fresh = res.data.outcomes.filter((s) => !outcomes.includes(s.id));
    setSuggestions(fresh);
    if (!fresh.length) {
      setAiNote(res.data.outcomes.length ? 'You already have every outcome it found.' : 'No clear outcome yet. Add a concrete detail and try again.');
    }
  };

  const accept = (s: OutcomeSuggestion) => {
    setOutcomes((prev) => (prev.includes(s.id) ? prev : [...prev, s.id].sort()));
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  };
  const dismiss = (s: OutcomeSuggestion) => setSuggestions((prev) => prev.filter((x) => x.id !== s.id));

  const save = async () => {
    if (!experience) return;
    if (!words) return setError('Write at least a sentence before saving.');
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.from('cas_reflections').upsert(
      {
        experience_id: experience.id,
        what_i_did: fields.what_i_did.trim() || null,
        what_i_learned: fields.what_i_learned.trim() || null,
        outcome_evidence: fields.outcome_evidence.trim() || null,
        outcomes,
        ai_flags: flags.length || checked ? { flags, questions, checked_at: new Date().toISOString() } : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'experience_id' },
    );
    if (saveError) {
      setSaving(false);
      return setError('Your reflection could not be saved. Please try again.');
    }
    // The reminder is no longer needed once the reflection exists.
    await supabase
      .from('reminders')
      .update({ is_enabled: false, status: 'cancelled' })
      .eq('dedupe_key', `cas_reflection:${experience.id}`)
      .then(() => undefined);
    router.push(`/app/cas/experience/${experience.id}`);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (missing || !experience) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">That experience was not found.</p>
        <Button asChild variant="outline" className="mt-4"><Link href="/app/cas">Back to CAS</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href={`/app/cas/experience/${experience.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {experience.title}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Reflection</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {experience.strands.map((s) => STRAND_LABEL[s]).join(' + ')} · {Number(experience.hours)} h
        {isNew && ' · Saved. Write a few lines now while it is fresh.'}
      </p>

      <Card className="mt-6 space-y-5 p-5 sm:p-6">
        {FIELD_META.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`ref-${f.key}`}>{f.label}</Label>
            <p className="text-xs text-muted-foreground">{f.hint}</p>
            <Textarea id={`ref-${f.key}`} rows={f.key === 'outcome_evidence' ? 3 : 4} maxLength={10000}
              value={fields[f.key]} onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))} />
          </div>
        ))}

        {flags.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
            <p className="font-medium text-amber-900 dark:text-amber-200">Could be more specific</p>
            <ul className="mt-2 space-y-2">
              {flags.map((f) => (
                <li key={f.sentence}>
                  <p className="text-amber-900 dark:text-amber-200">&ldquo;{f.sentence}&rdquo;</p>
                  <p className="text-xs text-muted-foreground">{f.issue} {f.prompt}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {aiAvailable && (
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Make it more specific</p>
              <Button type="button" size="sm" variant="outline" onClick={askFeedback} disabled={feedbackBusy || words < 8}>
                {feedbackBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MessageCircleQuestion className="mr-1.5 h-3.5 w-3.5" />}
                Ask AI for feedback
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">You get questions to think about. The AI never writes or rewrites your reflection.</p>
            {questions.length > 0 && (
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
                {questions.map((q) => <li key={q}>{q}</li>)}
              </ol>
            )}
            {checked && !questions.length && !flags.length && (
              <p className="mt-2 text-xs text-muted-foreground">Nothing vague found. Nice and specific.</p>
            )}
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-medium">Learning outcomes this shows</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {CAS_OUTCOMES.map((o) => {
              const on = outcomes.includes(o.id);
              return (
                <button key={o.id} type="button" role="checkbox" aria-checked={on} title={o.full} onClick={() => toggleOutcome(o.id)}
                  className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted/60')}>
                  {on && <Check className="h-3 w-3" />} {o.id}. {o.short}
                </button>
              );
            })}
          </div>
        </fieldset>

        {aiAvailable && (
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Which outcomes does this show?</p>
              <Button type="button" size="sm" variant="outline" onClick={askOutcomes} disabled={aiBusy || words < 8}>
                {aiBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                Suggest outcomes
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">AI reads your reflection and suggests outcomes. It never writes it for you.</p>
            {aiNote && <p className="mt-2 text-xs text-muted-foreground">{aiNote}</p>}
            {suggestions.length > 0 && (
              <ul className="mt-3 space-y-2">
                {suggestions.map((s) => {
                  const o = CAS_OUTCOMES.find((x) => x.id === s.id);
                  return (
                    <li key={s.id} className="flex items-start gap-2 rounded-lg border bg-background p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{s.id}. {o?.short}</p>
                        <p className="text-xs text-muted-foreground">{s.reason}</p>
                      </div>
                      <Button type="button" size="sm" className="h-7 px-2" onClick={() => accept(s)} aria-label={`Accept outcome ${s.id}`}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => dismiss(s)} aria-label={`Dismiss outcome ${s.id}`}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{words} words</span>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save reflection
          </Button>
        </div>
      </Card>
    </div>
  );
}
