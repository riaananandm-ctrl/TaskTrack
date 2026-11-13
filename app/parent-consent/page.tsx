'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/logo';
import { confirmParentConsent, parentLinkInfo } from '@/lib/consent';

type State = 'loading' | 'invalid' | 'expired' | 'done' | 'form';

/**
 * Page a parent or guardian opens from the link their child sends. Works without
 * signing in. It explains what TaskTrack does with their child's data and records
 * their consent with their name and the time.
 */
export default function ParentConsentPage() {
  const [token, setToken] = useState('');
  const [state, setState] = useState<State>('loading');
  const [child, setChild] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') ?? '';
    setToken(t);
    if (!/^[a-f0-9]{48}$/.test(t)) {
      setState('invalid');
      return;
    }
    parentLinkInfo(t).then((info) => {
      setChild(info.firstName);
      if (info.alreadyConfirmed) setState('done');
      else if (info.firstName === null && !info.valid) setState('invalid');
      else setState(info.valid ? 'form' : 'expired');
    });
  }, []);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const problem = await confirmParentConsent(token, name);
    if (problem) setError(problem);
    else setState('done');
    setSaving(false);
  };

  const who = child ?? 'your child';

  return (
    <div className="min-h-screen bg-[#F7F5F3] px-4 py-10 text-[#17264B] sm:py-16">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="inline-flex items-center gap-3">
          <Logo size={40} />
          <span className="text-xl font-bold tracking-tight">TaskTrack</span>
        </Link>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {state === 'loading' && (
            <div className="flex items-center gap-3 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" /> Checking the link…
            </div>
          )}

          {(state === 'invalid' || state === 'expired') && (
            <>
              <h1 className="text-2xl font-bold">This link doesn’t work</h1>
              <p className="mt-3 leading-7 text-slate-600">
                {state === 'expired'
                  ? 'It has expired. Links last 14 days.'
                  : 'It may be incomplete or already replaced by a newer link.'}{' '}
                Ask {who} to open Group Study in TaskTrack and make a new link for you.
              </p>
            </>
          )}

          {state === 'done' && (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-[#22B29E]" />
              <h1 className="mt-4 text-2xl font-bold">Thank you</h1>
              <p className="mt-3 leading-7 text-slate-600">
                {child ? `${child} can` : 'Your child can'} now use Group Study in TaskTrack. You can withdraw this at any
                time by emailing the TaskTrack team (contacts are on our{' '}
                <Link href="/#contact" className="text-[#315EDB] underline">
                  homepage
                </Link>
                ).
              </p>
            </div>
          )}

          {state === 'form' && (
            <>
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#315EDB]/10">
                  <ShieldCheck className="h-6 w-6 text-[#315EDB]" />
                </span>
                <h1 className="text-2xl font-bold">Parent or guardian consent</h1>
              </div>
              <p className="mt-4 leading-7 text-slate-600">
                <strong>{who}</strong> uses TaskTrack, a free study planner for school students. To use{' '}
                <strong>Group Study</strong> (private study rooms where students chat with classmates who have the
                room code, and can ask an AI tutor for help), we need a parent or guardian to agree.
              </p>

              <h2 className="mt-6 font-semibold">What you’re agreeing to</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
                <li>
                  TaskTrack stores {who}’s name, email, school year, tasks and study notes to run the app. We never sell
                  data or show ads.
                </li>
                <li>
                  In Group Study, other students in the room see {who}’s <strong>first name</strong> and messages.
                  Swear words are filtered out automatically, and anyone can report a message.
                </li>
                <li>
                  Questions sent to the AI tutor are processed by our AI provider to generate answers. The AI can make
                  mistakes and is not a teacher.
                </li>
                <li>
                  You can ask us to withdraw consent or delete {who}’s account at any time.
                </li>
              </ul>
              <p className="mt-3 text-sm text-slate-600">
                Full details:{' '}
                <Link href="/privacy" target="_blank" className="text-[#315EDB] underline">
                  Privacy Policy
                </Link>{' '}
                and{' '}
                <Link href="/terms" target="_blank" className="text-[#315EDB] underline">
                  Terms of Service
                </Link>
                .
              </p>

              <div className="mt-6 space-y-2">
                <Label htmlFor="parentName">Your full name</Label>
                <Input id="parentName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" />
              </div>

              <label className="mt-5 flex items-start gap-3 text-sm leading-6">
                <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-1" />
                <span>
                  I am {who}’s parent or legal guardian, I have read the Privacy Policy and Terms, and I agree to {who}{' '}
                  using TaskTrack, including Group Study.
                </span>
              </label>

              {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

              <Button
                className="mt-6 w-full bg-[#315EDB] hover:bg-[#274DBE]"
                size="lg"
                disabled={!agreed || name.trim().length < 2 || saving}
                onClick={confirm}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}I agree
              </Button>
              <p className="mt-3 text-center text-xs text-slate-500">
                Not the parent or guardian? Please close this page.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
