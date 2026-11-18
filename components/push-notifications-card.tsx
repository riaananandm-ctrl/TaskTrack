'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase/client';
import { patchUserSettingsCache } from '@/lib/user-settings-cache';
import {
  Bell, BellOff, BellRing, Loader2, Volume2, AlertTriangle, ShieldAlert,
  Send, CheckCircle2, Info, RotateCw, VolumeX,
} from 'lucide-react';
import {
  type PushStatus,
  type PushState,
  enableNotifications,
  disableNotifications,
  sendTestNotification,
  getPushStatus,
} from '@/lib/push-notifications';
import { playDing, markAudioUnlocked } from '@/lib/reminder-sound';

/**
 * The Notifications settings card. It never requests permission on its own: every
 * state shown here is read-only until the student presses a button, and the only
 * call that can raise the browser prompt is Enable Study Notifications.
 */

type Busy = null | 'enabling' | 'testing' | 'disabling' | 'local';

interface Feedback {
  kind: 'ok' | 'warn' | 'error';
  text: string;
}

const STATE_LABELS: Record<PushState, string> = {
  unsupported: 'Notifications unsupported',
  not_enabled: 'Enable notifications to receive deadline reminders.',
  asking: 'Enabling notifications...',
  enabled: 'Notifications are enabled on this device.',
  blocked: 'Notifications are blocked in browser settings.',
  setup_incomplete: 'Browser permission is enabled, but TaskTrack is not connected to this device. Reconnect notifications.',
  error: 'Notifications unavailable',
};

function badgeTone(state: PushState): string {
  switch (state) {
    case 'enabled':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900';
    case 'blocked':
    case 'error':
      return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900';
    case 'asking':
    case 'setup_incomplete':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function PushNotificationsCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundSaving, setSoundSaving] = useState(false);

  // Read-only inspection, run once when this card is shown. It does NOT ask the
  // browser for anything — it only reports what the browser already says.
  const refresh = useCallback(async () => {
    const next = await getPushStatus();
    setStatus(next);
    if (next.state === 'enabled') {
      setFeedback({ kind: 'ok', text: next.message ?? 'Notifications are enabled on this device.' });
    } else if (next.message && next.state !== 'not_enabled') {
      setFeedback({ kind: next.state === 'blocked' ? 'error' : 'warn', text: next.message });
    } else {
      setFeedback(null);
    }
    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user) {
      const { data } = await supabase
        .from('user_settings')
        .select('reminder_sound_enabled')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      setSoundEnabled(Boolean(data?.reminder_sound_enabled));
    }
  }, []);

  useEffect(() => {
    refresh();
    // Pick up the newest service worker straight away, so fixes to how
    // notifications are shown apply without waiting for the browser's own check.
    navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
  }, [refresh]);

  const handleEnable = async () => {
    if (busy !== null) return;
    setBusy('enabling');
    setFeedback(null);
    setStatus((prev) => (prev ? { ...prev, state: 'asking' } : prev));
    const next = await enableNotifications();
    setStatus(next);
    if (next.state === 'enabled') {
      setFeedback({ kind: 'ok', text: next.message ?? 'Notifications are enabled on this device.' });
    } else if (next.message) {
      setFeedback({ kind: next.state === 'blocked' ? 'error' : 'warn', text: next.message });
    }
    setBusy(null);
  };

  const handleTest = async () => {
    if (busy !== null) return;
    setBusy('testing');
    setFeedback(null);
    const result = await sendTestNotification();
    setFeedback({ kind: result.ok ? 'ok' : 'warn', text: result.message });
    setBusy(null);
  };

  const handleDisable = async () => {
    if (busy !== null) return;
    setBusy('disabling');
    setFeedback(null);
    const next = await disableNotifications();
    setStatus(next);
    setFeedback({ kind: 'warn', text: next.message ?? 'Notifications are turned off.' });
    setBusy(null);
  };

  const handleSoundToggle = async (next: boolean) => {
    markAudioUnlocked();
    if (next) playDing();
    setSoundEnabled(next);
    setSoundSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user) {
      await supabase
        .from('user_settings')
        .upsert({ user_id: auth.user.id, reminder_sound_enabled: next }, { onConflict: 'user_id' });
      patchUserSettingsCache(auth.user.id, { reminder_sound_enabled: next });
    }
    setSoundSaving(false);
  };

  // Shows a notification straight from this browser, without the internet or the
  // push service. If this one appears but "Test notification" doesn't, delivery is
  // the problem; if neither appears, the computer is hiding the browser's notifications.
  const handleLocalTest = async () => {
    if (busy !== null) return;
    setBusy('local');
    setFeedback(null);
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        setFeedback({ kind: 'error', text: 'This browser is not allowed to show notifications for TaskTrack. Allow them in the site settings (the icon left of the address bar).' });
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const title = 'TaskTrack check';
      const options = {
        body: 'If you can see this, your computer lets this browser show TaskTrack notifications.',
        tag: `tasktrack-local-${Date.now()}`,
        silent: false,
      };
      if (reg) await reg.showNotification(title, options);
      else new Notification(title, options);
      setFeedback({
        kind: 'ok',
        text: 'Shown straight from this browser. Nothing on screen? Your computer is hiding it: on a Mac open System Settings → Notifications → your browser (e.g. Google Chrome), turn on Allow notifications and choose Alerts, and switch off Focus / Do Not Disturb.',
      });
    } catch {
      setFeedback({ kind: 'error', text: 'This browser refused to show a notification. Check its notification settings for TaskTrack.' });
    } finally {
      setBusy(null);
    }
  };

  const handleTestSound = () => {
    markAudioUnlocked();
    playDing();
  };

  const state: PushState = status?.state ?? 'not_enabled';
  const isEnabled = state === 'enabled';
  const isUnsupported = state === 'unsupported';
  const isBlocked = state === 'blocked';
  const isSetupIncomplete = state === 'setup_incomplete';
  const canEnable = !isUnsupported && !isBlocked && !isEnabled && !isSetupIncomplete;
  const canReconnect = isSetupIncomplete;
  const canTest = isEnabled && busy === null;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center flex-shrink-0">
          <BellRing className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Study notifications</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Get reminded about upcoming study sessions and tasks, even when TaskTrack is in the
            background or closed. Nothing is sent until you turn this on here.
          </p>
        </div>
      </div>

      {/* Current state */}
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${badgeTone(state)}`}>
        {state === 'enabled' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          : state === 'blocked' || state === 'error' ? <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            : state === 'asking' ? <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
              : <Info className="w-4 h-4 flex-shrink-0" />}
        <span className="font-medium">{status ? STATE_LABELS[state] : 'Checking notification status...'}</span>
      </div>

      {feedback && (
        <div
          className={
            feedback.kind === 'ok'
              ? 'flex items-start gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 px-3 py-2 text-sm'
              : feedback.kind === 'error'
                ? 'flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-2 text-sm'
                : 'flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 px-3 py-2 text-sm'
          }
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Re-enable instructions when the browser has blocked them */}
      {isBlocked && (
        <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground space-y-1.5">
          <p className="font-medium text-foreground">How to re-enable notifications</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Open your browser&rsquo;s site settings for TaskTrack (the padlock or lock icon in the address bar).</li>
            <li>Set Notifications to &ldquo;Allow&rdquo;.</li>
            <li>Reload this page and press Enable Study Notifications again.</li>
          </ol>
          <p className="text-xs">
            On iPhone and iPad, notifications also require adding TaskTrack to your Home Screen first.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {canEnable && (
          <Button onClick={handleEnable} disabled={busy !== null}>
            {busy === 'enabling' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <Bell className="w-4 h-4 mr-2" />}
            {busy === 'enabling' ? 'Enabling notifications...' : 'Enable notifications'}
          </Button>
        )}

        {canReconnect && (
          <Button onClick={handleEnable} disabled={busy !== null}>
            {busy === 'enabling' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <RotateCw className="w-4 h-4 mr-2" />}
            {busy === 'enabling' ? 'Reconnecting...' : 'Reconnect notifications'}
          </Button>
        )}

        {isEnabled && (
          <>
            <Button variant="outline" onClick={handleTest} disabled={!canTest}>
              {busy === 'testing' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Send className="w-4 h-4 mr-2" />}
              Test notification
            </Button>

            <Button variant="outline" onClick={handleLocalTest} disabled={busy !== null}>
              {busy === 'local' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <BellRing className="w-4 h-4 mr-2" />}
              Show one now (this browser)
            </Button>

            <Button variant="ghost" onClick={handleDisable} disabled={busy !== null}>
              {busy === 'disabling' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <BellOff className="w-4 h-4 mr-2" />}
              Disable
            </Button>
          </>
        )}
      </div>

      {isUnsupported && (
        <p className="text-xs text-muted-foreground">
          This browser does not support TaskTrack notifications.
        </p>
      )}

      {/* In-app sound */}
      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <Volume2 className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Notification sounds</p>
              <p className="text-xs text-muted-foreground">
                Play one short ding when a reminder comes due while TaskTrack is open.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {soundSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            <Switch
              checked={soundEnabled}
              onCheckedChange={handleSoundToggle}
              aria-label="Play reminder sound"
            />
          </div>
        </div>

        {soundEnabled && (
          <Button variant="outline" size="sm" onClick={handleTestSound}>
            <Volume2 className="w-3.5 h-3.5 mr-1.5" />
            Test sound
          </Button>
        )}

        <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground space-y-1.5">
          <p>
            TaskTrack asks for non-silent notifications, but the final sound of a notification
            delivered while the app is closed is controlled by your browser and your macOS or
            device notification settings. TaskTrack cannot force a sound if those are muted.
          </p>
          <p>
            If you do not hear anything for a closed-app notification, check your system
            notification sound settings &mdash; the in-app ding above is separate and always works while
            TaskTrack is open.
          </p>
        </div>
      </div>

      {/* Background notifications note */}
      {!isUnsupported && !isEnabled && (
        <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Background reminders require server notification configuration. Enable notifications
            above to connect this device.
          </span>
        </div>
      )}
    </div>
  );
}
