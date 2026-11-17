'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Loader2, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Logo } from '@/components/logo';
import { acceptTerms, AgeBand, createParentLink, needsTerms, useConsent } from '@/lib/consent';
import { cn } from '@/lib/utils';

/**
 * Shown before the app until the student agrees to the current Terms and Privacy
 * Policy and says whether they are 18 or older. Covers email and Google sign-ups,
 * and existing accounts, alike.
 */
export function ConsentGate({ children }: { children: React.ReactNode }) {
  const { consent, loading, unavailable } = useConsent();
  if (loading || unavailable) return <>{children}</>;
  if (needsTerms(consent)) return <ConsentScreen />;
  return <>{children}</>;
}

function ConsentScreen() {
  const [agreed, setAgreed] = useState(false);
  const [age, setAge] = useState<AgeBand | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!agreed || !age) return;
    setSaving(true);
    setError(null);
    const problem = await acceptTerms(age);
    if (problem) setError(problem);
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-lg">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <span className="text-xl font-bold tracking-tight">TaskTrack</span>
        </div>
        <h1 className="mt-8 text-2xl font-bold tracking-tight sm:text-3xl">Before you start</h1>
        <p className="mt-2 text-muted-foreground">
          TaskTrack is used by school students, so we ask everyone the same two things.
        </p>

        <div className="mt-8 space-y-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div>
            <h2 className="font-semibold">How old are you?</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['adult', 'I’m 18 or older'],
                  ['minor', 'I’m under 18'],
                ] as [AgeBand, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAge(value)}
                  className={cn(
                    'rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold transition-colors',
                    age === value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {age && (
              <p className="mt-3 rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">
                You can use TaskTrack right away. To use <strong>Group Study</strong>, a parent or guardian needs to say
                it’s OK. We’ll give you a link to send them.
              </p>
            )}
          </div>

          <label className="flex items-start gap-3 text-sm leading-6">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-1" />
            <span>
              I agree to the{' '}
              <Link href="/terms" target="_blank" className="font-medium text-primary underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" target="_blank" className="font-medium text-primary underline">
                Privacy Policy
              </Link>
              , including the rules for respectful chat and honest use of AI.
            </span>
          </label>

          {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

          <Button className="w-full" size="lg" disabled={!agreed || !age || saving} onClick={save}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Make a consent link and send it to a parent or guardian.
 * Used on the Group Study page and in Settings.
 */
export function ParentConsentCard({ compact }: { compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setMaking(true);
    setError(null);
    const result = await createParentLink();
    if ('url' in result) setUrl(result.url);
    else setError(result.error);
    setMaking(false);
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is still visible to copy by hand.
    }
  };

  const message = url
    ? `Hi! I use TaskTrack for my school deadlines. To use its Group Study feature I need a parent or guardian to say it's OK. Please open this link: ${url}`
    : '';

  return (
    <div className={cn('rounded-2xl border border-primary/25 bg-primary/5', compact ? 'p-4' : 'p-5 sm:p-6')}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold">Ask a parent or guardian</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Group Study lets you chat with other students, so a parent or guardian needs to OK it first. Send them
            this link. It works for 14 days and only once.
          </p>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {!url ? (
        <Button className="mt-4" onClick={make} disabled={making}>
          {making ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
          Make a link for my parent
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="break-all rounded-lg border border-border bg-background p-3 font-mono text-xs">{url}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copy}>
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                Send on WhatsApp
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">When they confirm, Group Study unlocks here automatically.</p>
        </div>
      )}
    </div>
  );
}
