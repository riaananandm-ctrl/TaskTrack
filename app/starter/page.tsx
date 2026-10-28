'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/logo';
import { XpStreakWidget } from '@/components/xp-streak-widget';
import {
  XP_RULES,
  BADGE_KEYS,
  fetchOnboardingProgress,
  upsertOnboardingProgress,
  awardXp,
  recordMetric,
  OnboardingProgress,
} from '@/lib/gamification';
import {
  Loader2, Check, ArrowRight, ExternalLink,
  Calendar, Sparkles, Trophy, ShieldCheck, BookOpen,
  GraduationCap, Flame, Zap, HelpCircle, Bell, BellOff, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { connectManageBac, syncManageBac, verifyManageBacFeed } from '@/lib/managebac';
import { normalizeFeedUrl, maskFeedUrl } from '@/lib/feed-url';
import { enableNotifications, sendTestNotification, isPushSupported, getPushStatus, type PushStatus } from '@/lib/push-notifications';
import { ManageBacHelpDialog, FirstVisitHelpTooltip } from '@/components/managebac-help';

export default function StarterPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [managebacUrl, setManagebacUrl] = useState('');
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const [convertFeedback, setConvertFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [verifyState, setVerifyState] = useState<'idle' | 'verifying' | 'ok' | 'fail'>('idle');
  const [verifyFeedback, setVerifyFeedback] = useState<string | null>(null);
  const [manualTaskCount, setManualTaskCount] = useState(0);
  const [xpVersion, setXpVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [managebacError, setManagebacError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [notifStatus, setNotifStatus] = useState<PushStatus | null>(null);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifFeedback, setNotifFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [notifEnabled, setNotifEnabled] = useState(false);

  const loadProgress = useCallback(async () => {
    const data = await fetchOnboardingProgress();
    if (data) setProgress(data);
  }, []);

  useEffect(() => {
    if (!loading && user) {
      loadProgress();
      recordMetric('onboarding_started');
      if (isPushSupported()) {
        getPushStatus().then((s) => {
          setNotifStatus(s);
          setNotifEnabled(s.state === 'enabled');
        });
      }
    }
  }, [user, loading, router, loadProgress]);

  const updateStep = async (step: keyof OnboardingProgress, xp: number, reason: string, badge?: string) => {
    if (!user) return;
    setSaving(true);
    try {
      await upsertOnboardingProgress({ [step]: true } as Partial<OnboardingProgress>);
      await awardXp(xp, reason, badge);
      await loadProgress();
      setXpVersion((v) => v + 1);
    } catch {
      // Non-blocking: progress still saved locally.
    }
    setSaving(false);
  };

  const handleManagebacChange = (value: string) => {
    setManagebacUrl(value);
    setManagebacError(null);
    // Any edit resets conversion and verification: the server re-checks on Connect.
    setConvertedUrl(null);
    setConvertFeedback(null);
    setVerifyState('idle');
    setVerifyFeedback(null);
  };

  const handleConvert = async () => {
    const normalized = normalizeFeedUrl(managebacUrl);
    if (!normalized.ok) {
      setConvertFeedback({
        ok: false,
        text: 'That does not look like a ManageBac subscription link. Paste the webcal:// or https:// link from ManageBac → Calendar → Subscribe to Calendar.',
      });
      setConvertedUrl(null);
      setVerifyState('idle');
      return;
    }
    setConvertedUrl(normalized.url);
    setConvertFeedback({ ok: true, text: 'Your link is ready for TaskTrack.' });
    // Step 2 receives the converted URL automatically and verifies it right away:
    // no copying or pasting again. Conversion alone never claims accessibility.
    setVerifyState('verifying');
    setVerifyFeedback(null);
    const result = await verifyManageBacFeed(normalized.url);
    if (result.ok) {
      setVerifyState('ok');
      setVerifyFeedback(result.empty
        ? 'Calendar verified. No events found in this feed right now.'
        : 'Calendar verified. Ready to connect.');
    } else {
      setVerifyState('fail');
      setVerifyFeedback(result.error ?? 'We could not reach that calendar. Check the link and try again.');
    }
  };

  const handleManagebacConnect = async () => {
    if (!user || !convertedUrl || verifyState !== 'ok') return;
    setSaving(true);
    setManagebacError(null);
    setImportedCount(null);
    const retryMessage = 'We could not read that calendar link. Return to ManageBac, choose Subscribe to Calendar, copy the link again, and try once more.';
    try {
      // The server normalizes and validates the link again on Connect; the earlier
      // verification is only a UX step and is never trusted here.
      const connection = await connectManageBac(convertedUrl);
      if (!connection.ok) {
        setManagebacError(retryMessage);
        return;
      }

      const sync = await syncManageBac();
      if (!sync.ok) {
        setManagebacError(retryMessage);
        return;
      }

      const imported = (sync.imported ?? 0) + (sync.updated ?? 0);
      setImportedCount(imported);
      await updateStep('step_managebac_connected', XP_RULES.managebac_connected, 'managebac_connected', BADGE_KEYS.managebac_connected);
      if (imported > 0) {
        await awardXp(XP_RULES.first_task_imported_from_managebac, 'first_task_imported_from_managebac');
      }
      setManagebacUrl('');
      setConvertedUrl(null);
      setConvertFeedback(null);
      setVerifyState('idle');
      setVerifyFeedback(null);
    } catch {
      setManagebacError(retryMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleManualTaskFallback = async () => {
    if (!user || manualTaskCount >= 3) return;
    setSaving(true);
    try {
      await supabase.from('tasks').insert({
        user_id: user.id,
        title: `Onboarding task ${manualTaskCount + 1}`,
        description: 'Added during setup',
        category: 'homework',
        priority: 'medium',
        status: 'not_started',
      });
      const newCount = manualTaskCount + 1;
      setManualTaskCount(newCount);
      if (newCount === 1) {
        await updateStep('step_first_task_added', XP_RULES.task_added, 'first_task_added', BADGE_KEYS.first_task_added);
      }
      if (newCount >= 3) {
        await updateStep('step_managebac_connected', XP_RULES.managebac_connected, 'managebac_connected_manual', BADGE_KEYS.managebac_connected);
      }
    } catch {
      // Error is non-critical for onboarding flow.
    }
    setSaving(false);
  };

  const handleEnableNotifications = async () => {
    if (notifBusy) return;
    setNotifBusy(true);
    setNotifFeedback(null);
    try {
      const result = await enableNotifications();
      setNotifStatus(result);
      if (result.state === 'enabled') {
        setNotifEnabled(true);
        setNotifFeedback({ ok: true, text: 'Notifications enabled.' });
        const test = await sendTestNotification();
        if (!test.ok) {
          setNotifFeedback({ ok: true, text: 'Notifications enabled. You can send a test from Settings.' });
        }
      } else if (result.state === 'blocked') {
        setNotifFeedback({ ok: false, text: 'Notifications are blocked for this site. You can enable them later in your browser settings.' });
      } else if (result.state === 'not_enabled') {
        setNotifFeedback({ ok: false, text: 'No problem — you can enable notifications later in Settings.' });
      } else if (result.message) {
        setNotifFeedback({ ok: false, text: result.message });
      }
    } catch {
      setNotifFeedback({ ok: false, text: 'Could not enable notifications. You can try again later in Settings.' });
    } finally {
      setNotifBusy(false);
    }
  };

  const handleCompleteOnboarding = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', user.id);
      await upsertOnboardingProgress({ step_onboarding_completed: true });
      await awardXp(XP_RULES.onboarding_completed, 'onboarding_completed', BADGE_KEYS.onboarding_completed);
      await recordMetric('onboarding_completed');
      router.push('/app');
    } catch {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="flex items-center justify-center rounded-2xl bg-white p-3 shadow-soft dark:bg-slate-900">
          <Logo size={52} showText={false} />
        </div>
        <p className="text-sm text-muted-foreground">Getting started...</p>
      </div>
    );
  }

  const managebacDone = progress?.step_managebac_connected;
  const aiDone = progress?.step_ai_session_created;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Logo />
        </div>

        {/* Layout: hero + sidebar with XP widget */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-6 mb-8">
          {/* ManageBac hero — the first and biggest thing */}
          <Card className="relative overflow-hidden p-8 sm:p-10 bg-gradient-to-br from-blue-600 to-sky-500 text-white border-0">
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-12 -mt-12" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-7 h-7" />
                <span className="text-sm font-medium uppercase tracking-wide opacity-90">Step 1 — Get connected</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-3">
                Connect ManageBac — see all your deadlines in one place
              </h1>
              <p className="text-base opacity-90 mb-6 max-w-lg">
                TaskTrack connects to your ManageBac calendar using a subscription link. You do not need to create or copy an API key.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  size="lg"
                  variant="secondary"
                  className="bg-white text-blue-700 hover:bg-white/90"
                  onClick={() => document.getElementById('managebac-checklist')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Connect ManageBac <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-white hover:bg-white/20 border border-white/30"
                  onClick={() => document.getElementById('manual-fallback')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  I'll add tasks manually for now
                </Button>
              </div>

              {/* Help link for confused new users */}
              <div className="mt-2">
                <FirstVisitHelpTooltip>
                  <button
                    onClick={() => setHelpOpen(true)}
                    className="text-sm text-white/80 hover:text-white underline-offset-2 hover:underline flex items-center gap-1"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    Not sure how to integrate ManageBac?
                  </button>
                </FirstVisitHelpTooltip>
              </div>
              {managebacDone && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium bg-white/20 rounded-lg px-3 py-2 w-fit">
                    <Check className="w-4 h-4" /> ManageBac connected — +{XP_RULES.managebac_connected} XP earned
                  </div>
                  {importedCount !== null && <p className="text-sm text-white/90">Imported {importedCount} task{importedCount === 1 ? '' : 's'} and event{importedCount === 1 ? '' : 's'}.</p>}
                </div>
              )}
            </div>
          </Card>

          {/* XP widget — secondary, off to the side */}
          <div className="space-y-3">
            <XpStreakWidget compact key={xpVersion} />
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Earn XP as you set up TaskTrack</p>
            </div>
          </div>
        </div>

        {/* ManageBac calendar checklist — immediately below hero, not hidden */}
        <section id="managebac-checklist" className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">Connect ManageBac — step by step</h2>
            {managebacDone && (
              <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950/30 px-2 py-1 rounded-full">
                <Check className="w-3 h-3" /> Done
              </span>
            )}
          </div>

          <div className="space-y-3">
            <StepItem
              number={1}
              title="Open ManageBac and log in"
              done={managebacDone}
              action={
                <a href="https://www.managebac.com/login" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    Open ManageBac <ExternalLink className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </a>
              }
            />
            <StepItem number={2} title="Go to your Calendar" done={managebacDone} />
            <StepItem number={3} title="Open your full calendar if necessary" done={managebacDone} />
            <StepItem number={4} title="Click “Subscribe to Calendar”" done={managebacDone} />
            <StepItem number={5} title="Copy the calendar subscription link/URL" description="Treat your calendar subscription link as private. Do not share it publicly." done={managebacDone} />
            <StepItem number={6} title="Return to TaskTrack" done={managebacDone} />
            <StepItem
              number={7}
              title="Paste your calendar link, then click “Convert link”"
              description="Find it in ManageBac → Calendar → Subscribe to Calendar → Copy link. TaskTrack makes the link compatible before connecting."
              done={managebacDone}
            >
              <div className="mt-3 space-y-2">
                <Label htmlFor="managebac-url" className="text-xs">ManageBac calendar subscription link</Label>
                <Input
                  id="managebac-url"
                  placeholder="Paste your ManageBac calendar link here"
                  value={managebacUrl}
                  onChange={(e) => handleManagebacChange(e.target.value)}
                  disabled={!!managebacDone || saving}
                  autoComplete="off"
                  spellCheck={false}
                />
                {convertFeedback && (
                  <p className={cn(
                    'text-xs px-2 py-1.5 rounded-md',
                    convertFeedback.ok
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                  )}>
                    {convertFeedback.text}
                  </p>
                )}
              </div>
            </StepItem>
            <StepItem
              number={8}
              title="Click “Convert link”, then verify & connect"
              description="The converted link is carried into verification automatically — no copying or repasting. Connect unlocks once the calendar is verified."
              done={managebacDone}
            />
            <StepItem number={9} title="Wait for TaskTrack to import your deadlines" description="Your imported tasks and events will be available across the app." done={managebacDone} />
            <StepItem number={10} title="Confirm imported tasks appear in Tasks, Planning, and Calendar" done={managebacDone} />
          </div>

          {!managebacDone && (
            <div className="mt-4 space-y-3">
              {managebacError && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {managebacError}
                </p>
              )}
              <div className="flex items-center justify-between gap-4">
                {importedCount !== null && <p className="text-sm text-green-700 dark:text-green-400">Imported {importedCount} task{importedCount === 1 ? '' : 's'} and event{importedCount === 1 ? '' : 's'}.</p>}
                <div className="ml-auto flex flex-col items-end gap-2">
                  <Button onClick={handleConvert} disabled={saving || !managebacUrl.trim() || !!convertedUrl} variant="outline" size="lg">
                    {verifyState === 'verifying' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Convert link
                  </Button>
                  {verifyFeedback && (
                    <p className={cn(
                      'text-xs px-2 py-1.5 rounded-md',
                      verifyState === 'ok'
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                        : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                    )}>
                      {verifyFeedback}
                    </p>
                  )}
                  <Button onClick={handleManagebacConnect} disabled={saving || verifyState !== 'ok'} size="lg">
                    Connect ManageBac <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Manual fallback */}
        <section id="manual-fallback" className="mb-10">
          <Card className="p-5 border-dashed">
            <div className="flex items-start gap-3">
              <BookOpen className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Can’t use a calendar subscription? You can still use TaskTrack.</p>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  If your school does not allow calendar subscriptions, add 3 tasks manually to complete this step.
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualTaskFallback}
                    disabled={saving || manualTaskCount >= 3}
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                    {manualTaskCount >= 3 ? 'Done' : `Add task (${manualTaskCount}/3)`}
                  </Button>
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={cn(
                          'w-2 h-2 rounded-full transition-colors',
                          i < manualTaskCount ? 'bg-green-500' : 'bg-slate-200 dark:bg-slate-700'
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* Notification setup — optional, gesture-gated */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">Enable deadline notifications</h2>
            {notifEnabled && (
              <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950/30 px-2 py-1 rounded-full">
                <Check className="w-3 h-3" /> Done
              </span>
            )}
          </div>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-4">
              Allow TaskTrack to remind you about upcoming deadlines. You can change this later in Settings.
            </p>
            {notifFeedback && (
              <div className={cn(
                'flex items-start gap-2 rounded-lg px-3 py-2 text-sm mb-4',
                notifFeedback.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
              )}>
                {notifFeedback.ok ? <Check className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                <span>{notifFeedback.text}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!notifEnabled && (
                <Button type="button" onClick={handleEnableNotifications} disabled={notifBusy}>
                  {notifBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Bell className="w-4 h-4 mr-2" />}
                  {notifBusy ? 'Enabling notifications...' : 'Enable notifications'}
                </Button>
              )}
              {notifEnabled && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-green-500" /> Notifications enabled. Manage them in Settings.
                </p>
              )}
            </div>
          </Card>
        </section>

        {/* Section B: Study Sessions AI */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">Plan your week with Study Sessions AI</h2>
            {aiDone && (
              <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950/30 px-2 py-1 rounded-full">
                <Check className="w-3 h-3" /> Done
              </span>
            )}
          </div>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-6">
              Study Sessions AI works from your own tasks to create study plans, explain topics, and generate practice questions.
            </p>
            <div className="space-y-3">
              <StepItem number={1} title="Pick your next big exam or task" description="Choose from your upcoming assessments in Study Sessions." done={aiDone} />
              <StepItem number={2} title="Tell Study Sessions AI what you need" description="Create a study plan, explain a topic, generate practice questions, or summarise your notes." done={aiDone} />
              <StepItem number={3} title="Choose how much time you have" description="30 minutes, 1 hour, or this week — the AI plans around your schedule." done={aiDone} />
              <StepItem number={4} title="Let AI build your plan" description="AI breaks your goal into focused sessions. This takes a few seconds." done={aiDone} />
              <StepItem number={5} title="Review and adjust the plan" description="Move sessions, change durations, or skip items — it's your plan." done={aiDone} />
              <StepItem number={6} title="Start your first session" description="Begin a focus session with a Pomodoro-style timer." done={aiDone} />
              <StepItem number={7} title="Finish the session and earn XP" description={`On completion, you'll earn ${XP_RULES.first_ai_study_session} XP and see a small celebration.`} done={aiDone} />
            </div>
            <div className="flex gap-2 mt-6 pt-4 border-t border-border">
              <Button
                variant="outline"
                onClick={() => updateStep('step_ai_session_created', XP_RULES.first_ai_study_session, 'ai_study_plan_created', BADGE_KEYS.first_ai_study_session)}
                disabled={saving || !!aiDone}
              >
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                I'll try it later
              </Button>
              <Button
                onClick={() => {
                  updateStep('step_ai_session_created', XP_RULES.first_ai_study_session, 'ai_study_plan_created', BADGE_KEYS.first_ai_study_session);
                  router.push('/app/study-sessions');
                }}
                disabled={saving}
              >
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Open Study Sessions <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </Card>
        </section>

        {/* Section C: Progress */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">Track progress, streaks, and XP</h2>
          </div>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-6">
              Earn XP for real work — adding tasks, completing them, and studying with focus sessions. Your streak shows how consistently you're studying.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <RewardCard icon={Zap} label="Task added" xp={XP_RULES.task_added} />
              <RewardCard icon={Check} label="Task completed" xp={XP_RULES.task_completed} />
              <RewardCard icon={Flame} label="Focus session" xp={XP_RULES.focus_session_25m} />
              <RewardCard icon={Calendar} label="ManageBac" xp={XP_RULES.managebac_connected} />
              <RewardCard icon={Sparkles} label="AI study plan" xp={XP_RULES.first_ai_study_session} />
              <RewardCard icon={Trophy} label="Onboarding" xp={XP_RULES.onboarding_completed} />
              <RewardCard icon={BookOpen} label="Task imported" xp={XP_RULES.first_task_imported_from_managebac} />
              <RewardCard icon={Calendar} label="Day planned" xp={XP_RULES.planned_day} />
            </div>

            {/* Social study rooms teaser */}
            <div className="rounded-xl border border-dashed border-border p-4 mb-6">
              <div className="flex items-start gap-3">
                <GraduationCap className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Study with friends — optional</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Join or create a study room with synchronized timers. This is optional — you can use TaskTrack fully without it.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleCompleteOnboarding} disabled={saving} size="lg">
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Go to dashboard <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </Card>
        </section>

        {/* ManageBac help dialog */}
        <ManageBacHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

        {/* Security reassurance */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5" />
          Your data is private and encrypted. Only you can see your tasks and progress.
        </div>
      </div>
    </div>
  );
}

function StepItem({
  number,
  title,
  description,
  done,
  action,
  icon,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  done?: boolean;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4 transition-colors', done ? 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20' : 'border-border')}>
      <div
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
          done ? 'bg-green-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
        )}
      >
        {done ? <Check className="w-3.5 h-3.5" /> : number}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-medium">{title}</p>
        </div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        {children}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

function RewardCard({ icon: Icon, label, xp }: { icon: typeof Zap; label: string; xp: number }) {
  return (
    <div className="flex flex-col items-center text-center p-3 rounded-xl border border-border">
      <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center mb-2">
        <Icon className="w-5 h-5 text-amber-600" />
      </div>
      <p className="text-xs font-medium">{label}</p>
      <p className="text-sm font-bold text-amber-600">+{xp} XP</p>
    </div>
  );
}
