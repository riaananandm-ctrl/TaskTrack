'use client';

import { useEffect, useState } from 'react';
import { BellRing, BellOff, Share, X, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { enableNotifications, getPushStatus, isIosBrowserTab, isPushSupported } from '@/lib/push-notifications';

const SNOOZE_KEY = 'tasktrack:notification-prompt-snoozed-until';
const SNOOZE_DAYS = 7;

type PromptKind = 'enable' | 'blocked' | 'ios-install';

function isSnoozed(): boolean {
  try {
    const until = Number(window.localStorage.getItem(SNOOZE_KEY) || 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Storage blocked: the prompt simply comes back next visit.
  }
}


/**
 * Asks students to turn on notifications so they get a reminder the day before each
 * deadline. The browser permission dialog only ever opens from the button click (a
 * user gesture), never on page load. "Not now" hides it for a week.
 */
export function NotificationPrompt() {
  const [kind, setKind] = useState<PromptKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isSnoozed()) return;

    if (!isPushSupported()) {
      if (isIosBrowserTab()) setKind('ios-install');
      return;
    }

    getPushStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.state === 'not_enabled' || status.state === 'setup_incomplete') setKind('enable');
        else if (status.state === 'blocked') setKind('blocked');
      })
      .catch(() => {
        // Status unavailable: stay hidden rather than nag.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setKind(null), 4000);
    return () => clearTimeout(t);
  }, [done]);

  if (!kind) return null;

  const dismiss = () => {
    snooze();
    setKind(null);
  };

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const status = await enableNotifications();
      if (status.state === 'enabled') {
        setDone(true);
      } else if (status.state === 'blocked') {
        setKind('blocked');
      } else if (status.message) {
        setMessage(status.message);
      }
    } catch {
      setMessage('Notifications could not be turned on. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 animate-slide-up dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 className="h-5 w-5 flex-shrink-0" aria-hidden />
        Notifications are on. We&rsquo;ll remind you the day before each task is due.
      </div>
    );
  }

  const content = {
    enable: {
      icon: BellRing,
      title: 'Never miss a deadline',
      body: 'Turn on notifications and TaskTrack will remind you on this device the day before each task is due.',
    },
    blocked: {
      icon: BellOff,
      title: 'Notifications are blocked',
      body: 'To get a reminder the day before each deadline, allow notifications for this site in your browser settings, then reload the page.',
    },
    'ios-install': {
      icon: Share,
      title: 'Get reminders on your iPhone',
      body: 'Tap the Share button, then “Add to Home Screen”. Open TaskTrack from your Home Screen to turn on reminders.',
    },
  }[kind];
  const Icon = content.icon;

  return (
    <section
      aria-label="Notifications"
      className="mb-6 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-sky-50 p-4 shadow-soft animate-slide-up dark:border-blue-900 dark:from-blue-950/40 dark:to-sky-950/20"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white text-primary shadow-soft dark:bg-blue-950/60">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-semibold text-navy-900 dark:text-blue-100">{content.title}</p>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-blue-200/80">{content.body}</p>
          {message && <p className="mt-1 text-xs font-medium text-destructive">{message}</p>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {kind === 'enable' && (
            <Button size="sm" onClick={turnOn} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <BellRing className="mr-1.5 h-4 w-4" aria-hidden />}
              Turn on notifications
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={dismiss} className="text-slate-600 dark:text-blue-200">
            Not now
          </Button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss notification prompt"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/70 dark:hover:bg-blue-950/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
