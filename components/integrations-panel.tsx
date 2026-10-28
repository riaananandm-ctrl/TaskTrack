'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, Lock, Presentation, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Logo } from '@/components/logo';
import { ProFeatureGate } from '@/components/pro-feature-gate';
import { ManageBacCard } from '@/components/managebac-card';

/**
 * The integrations content, shown as a tab inside Settings. It has no page of its own
 * so students find it in the same place as the rest of their preferences.
 */
export function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      {/* ManageBac Calendar subscription */}
      <ManageBacCard />

      {/* Google Classroom */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-50 dark:bg-green-950/30 flex items-center justify-center flex-shrink-0">
            <Calendar className="w-6 h-6 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h2 className="text-lg font-semibold">Google Classroom</h2>
              <Badge variant="secondary" className="text-xs">Coming soon</Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Import assignments from Google Classroom into TaskTrack automatically.
              Integration will be added in a future update.
            </p>
            <Button disabled size="sm">
              <Lock className="w-3.5 h-3.5 mr-1" /> Connect Google Classroom
            </Button>
            <p className="text-xs text-muted-foreground mt-2">Not connected.</p>
          </div>
        </div>
      </Card>

      {/* TaskTrack AI */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center flex-shrink-0">
            <Logo size={30} showText={false} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h2 className="text-lg font-semibold">TaskTrack AI</h2>
              <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100">
                Included
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              TaskTrack AI is built in and shared across every TaskTrack account. It runs
              securely behind our own backend, so you never need to add an API key and none
              is ever shown here.
            </p>
            <div className="flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Nothing to set up — open any task and choose Study Session to use it.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Google Slides export (Pro) */}
      <ProFeatureGate
        feature="googleSlidesExport"
        title="Google Slides export"
        description="Export study slides to Google Slides once you connect Google Drive."
      >
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center flex-shrink-0">
              <Presentation className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold">Google Slides export</h2>
              <p className="text-sm text-muted-foreground mb-4 mt-1">
                Send generated study slides straight to Google Slides through your connected Google Drive.
              </p>
              <Button disabled size="sm">
                <Lock className="w-3.5 h-3.5 mr-1" /> Connect Google Drive
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Not connected. Google Drive connection will be available in a future update.
              </p>
            </div>
          </div>
        </Card>
      </ProFeatureGate>
    </div>
  );
}
