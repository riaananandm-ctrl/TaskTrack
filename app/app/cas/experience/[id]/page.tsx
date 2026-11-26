'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ExternalLink, Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/client';
import {
  CAS_OUTCOMES,
  STRAND_LABEL,
  type CasExperience,
  type CasReflection,
  evidenceLink,
} from '@/lib/cas';

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for your supervisor to confirm',
  confirmed: 'Confirmed by your supervisor',
  queried: 'Your supervisor has a question about this',
};

interface Flag { sentence: string; issue: string; prompt: string }

export default function CasExperiencePage() {
  const { id } = useParams<{ id: string }>();
  const [exp, setExp] = useState<CasExperience | null>(null);
  const [ref, setRef] = useState<CasReflection | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: e }, { data: r }] = await Promise.all([
        supabase.from('cas_experiences').select('*').eq('id', id).maybeSingle(),
        supabase.from('cas_reflections').select('*').eq('experience_id', id).maybeSingle(),
      ]);
      setExp((e as CasExperience | null) ?? null);
      setRef((r as CasReflection | null) ?? null);
      if (e?.evidence_url) setEvidence(await evidenceLink(e.evidence_url));
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!exp) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">That experience was not found.</p>
        <Button asChild variant="outline" className="mt-4"><Link href="/app/cas">Back to CAS</Link></Button>
      </div>
    );
  }

  const flags: Flag[] = Array.isArray((ref?.ai_flags as { flags?: Flag[] } | null)?.flags)
    ? (ref?.ai_flags as { flags: Flag[] }).flags
    : [];
  const dates = `${format(parseISO(exp.start_date), 'd MMM yyyy')}${exp.end_date && exp.end_date !== exp.start_date ? ` to ${format(parseISO(exp.end_date), 'd MMM yyyy')}` : ''}`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/app/cas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> CAS
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{exp.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {exp.strands.map((s) => STRAND_LABEL[s]).join(' + ')} · {Number(exp.hours)} h · {dates}
      </p>

      <Card className="mt-6 space-y-3 p-5 text-sm">
        {exp.description && <p className="whitespace-pre-wrap">{exp.description}</p>}
        {exp.supervisor_name && (
          <p><span className="text-muted-foreground">Supervisor:</span> {exp.supervisor_name}{exp.supervisor_email ? ` (${exp.supervisor_email})` : ''}</p>
        )}
        <p><span className="text-muted-foreground">Verification:</span> {STATUS_TEXT[exp.verification_status]}</p>
        {evidence && (
          <a href={evidence} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            View evidence <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </Card>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-semibold">Reflection</h2>
        <Button asChild size="sm" variant={ref ? 'outline' : 'default'}>
          <Link href={`/app/cas/reflection/${exp.id}`}><PenLine className="mr-1.5 h-4 w-4" /> {ref ? 'Edit' : 'Write reflection'}</Link>
        </Button>
      </div>
      {ref ? (
        <Card className="mt-3 space-y-4 p-5 text-sm">
          {[
            ['What I did', ref.what_i_did],
            ['What I learned', ref.what_i_learned],
            ['Which outcome, and how', ref.outcome_evidence],
          ].map(([label, text]) => text ? (
            <div key={label}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 whitespace-pre-wrap">{text}</p>
            </div>
          ) : null)}
          {ref.outcomes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ref.outcomes.map((n) => (
                <span key={n} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {n}. {CAS_OUTCOMES.find((o) => o.id === n)?.short}
                </span>
              ))}
            </div>
          )}
          {flags.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
              <p className="text-xs font-semibold">Could be more specific</p>
              <ul className="mt-1 space-y-1.5">
                {flags.map((f) => <li key={f.sentence}>&ldquo;{f.sentence}&rdquo; {f.prompt}</li>)}
              </ul>
            </div>
          )}
        </Card>
      ) : (
        <Card className="mt-3 p-5 text-sm text-muted-foreground">No reflection yet. A few honest lines are enough.</Card>
      )}
    </div>
  );
}
