'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RELEASES, markReleasesSeen } from '@/lib/whats-new';

export default function WhatsNewPage() {
  useEffect(() => {
    markReleasesSeen();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
          <Sparkles className="h-4 w-4" aria-hidden /> What&rsquo;s new
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">New in TaskTrack</h1>
        <p className="mt-2 text-sm text-muted-foreground">Everything we have added recently, newest first.</p>
      </div>

      <div className="space-y-8">
        {RELEASES.map((release, index) => (
          <section key={release.id} aria-labelledby={`release-${release.id}`}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`release-${release.id}`} className="text-lg font-semibold">{release.title}</h2>
              <time dateTime={release.date} className="text-sm text-muted-foreground">
                {format(parseISO(release.date), 'd MMMM yyyy')}
              </time>
              {index === 0 && <Badge className="text-xs">Latest</Badge>}
            </div>
            <Card className="divide-y divide-border">
              {release.items.map((item) => (
                <div key={item.title} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{item.title}</h3>
                    {item.tag && <Badge variant="secondary" className="text-xs">{item.tag}</Badge>}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
                  {item.href && (
                    <Link
                      href={item.href}
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                    >
                      Try it <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
              ))}
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
