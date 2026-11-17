'use client';

import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Copy, Check, Users, Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { createParentSummaryLink, getParentSummaryStatus, revokeParentSummaryLink } from '@/lib/ib-data';

/**
 * Optional weekly summary for a parent or guardian. It's a private link (not an
 * email) that shows only: first name, tasks finished this week, tasks due in the
 * next 7 days, upcoming exams and the study streak. The student can make a new
 * link (the old one stops working) or turn it off at any time.
 */
export function ParentSummaryCard() {
  const [on, setOn] = useState(false);
  const [since, setSince] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getParentSummaryStatus()
      .then((s) => {
        setOn(s.on);
        setSince(s.since);
      })
      .catch(() => setError('This setting could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  const makeLink = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await createParentSummaryLink());
      setOn(true);
      setSince(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      await revokeParentSummaryLink();
      setOn(false);
      setLink(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be turned off.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Couldn’t copy. Select the link and copy it yourself.');
    }
  };

  const whatsapp = link
    ? `https://wa.me/?text=${encodeURIComponent(`Here's my weekly TaskTrack summary: ${link}`)}`
    : null;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <Users className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold">Weekly summary for a parent (optional)</h3>
            <p className="text-sm text-muted-foreground mt-1">
              A private link your parent or guardian can open any time. It shows only your first name, tasks you finished
              this week, what&rsquo;s due in the next 7 days, upcoming exams and your study streak. Never your notes,
              chats, drafts or grades.
            </p>
          </div>
        </div>
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={on}
            disabled={busy}
            onCheckedChange={(v) => (v ? makeLink() : turnOff())}
            aria-label="Share a weekly summary with a parent"
          />
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {on && link && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Send this link to your parent. It&rsquo;s only shown once, so copy it now.</p>
          <p className="break-all rounded bg-background px-2 py-1.5 font-mono text-xs">{link}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={copy} className="gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy link'}
            </Button>
            {whatsapp && (
              <Button size="sm" variant="outline" asChild className="gap-1.5">
                <a href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="w-3.5 h-3.5" /> Send on WhatsApp</a>
              </Button>
            )}
          </div>
        </div>
      )}

      {on && !link && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground">
            Sharing is on{since ? ` since ${format(parseISO(since), 'd MMM yyyy')}` : ''}. Lost the link?
          </p>
          <Button size="sm" variant="outline" onClick={makeLink} disabled={busy}>Make a new link</Button>
        </div>
      )}
      {on && (
        <p className="text-xs text-muted-foreground">Making a new link or turning this off stops the old link working straight away.</p>
      )}
    </Card>
  );
}
