'use client';

import { supabase } from '@/lib/supabase/client';

/**
 * Browser push support is entirely opt-in. The browser permission dialog only opens
 * from a button the student presses (in Settings or the in-app NotificationPrompt);
 * on page load the prompt only reads the current status via getPushStatus(). The VAPID private key and the cron
 * secret live only in the database and are never fetched here; the browser reads the
 * public key alone.
 */

export type PushSupport = 'supported' | 'unsupported';

/** The states the Settings screen can display. */
export type PushState =
  | 'unsupported'
  | 'not_enabled'
  | 'asking'
  | 'enabled'
  | 'blocked'
  | 'setup_incomplete'
  | 'error';

export interface PushStatus {
  state: PushState;
  /** Whether the browser itself currently grants permission. */
  permission: NotificationPermission | 'unsupported';
  /** True when a live push subscription exists for this device. */
  hasSubscription: boolean;
  /** True when the subscription is saved on the server for this user. */
  hasServerSubscription: boolean;
  /** Message to show the student, when there is one. */
  message?: string;
}

const SW_PATH = '/sw.js';
const ENABLE_TIMEOUT_MS = 10_000;

/** Branded confirmation shown after a successful enable. */
export const ENABLED_MESSAGE =
  'Notifications are enabled on this device.';
export const UNSUPPORTED_MESSAGE =
  'This browser does not support TaskTrack notifications.';
export const BLOCKED_MESSAGE =
  'Notifications are blocked for this site. Allow them in your browser\'s site settings, then try again.';
export const SETUP_INCOMPLETE_MESSAGE =
  'Browser permission is enabled, but TaskTrack is not connected to this device. Reconnect notifications.';

/** True only when every browser API this feature depends on is present. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function currentPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Register the TaskTrack service worker, reusing the existing registration. */
async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_PATH, { scope: '/' });
}

/** Decode a base64url VAPID key into the bytes the Push API expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** The public VAPID key, fetched from the server. Never the private key. */
async function fetchVapidPublicKey(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_push_vapid_public_key');
  if (error || typeof data !== 'string' || !data.trim()) return null;
  return data;
}

/** An existing subscription for this device, if the browser already made one. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/** Check whether the server has a subscription saved for the current user. */
async function checkServerSubscription(): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return false;
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('user_id', auth.user.id)
    .is('disabled_at', null)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Create the push subscription for this device and save it against the signed-in
 * student. The endpoint is the conflict key, so re-enabling on the same device
 * updates the stored keys instead of piling up rows.
 */
async function createAndSaveSubscription(): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return false;

  const vapidPublicKey = await fetchVapidPublicKey();
  if (!vapidPublicKey) return false;

  const registration = await registerServiceWorker();
  // Wait for the worker to take control so the subscription is bound to it.
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const authKey = json.keys?.auth;
  if (!endpoint || !p256dh || !authKey) return false;

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: auth.user.id,
      endpoint,
      p256dh,
      auth: authKey,
      user_agent: navigator.userAgent.slice(0, 400),
      disabled_at: null,
      failure_count: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  );

  return !error;
}

/** Set the push_enabled app preference. This is NOT the source of truth for display. */
async function setPushPreference(enabled: boolean): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return;
  await supabase
    .from('user_settings')
    .upsert({ user_id: auth.user.id, push_enabled: enabled }, { onConflict: 'user_id' });
}

/** Promise that rejects after `ms` milliseconds with the given message. */
function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  );
}

/**
 * The single place that inspects every signal and reports one clear state. Called
 * only from the Settings screen. Uses Notification.permission as the source of truth.
 */
export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) {
    return {
      state: 'unsupported',
      permission: 'unsupported',
      hasSubscription: false,
      hasServerSubscription: false,
      message: UNSUPPORTED_MESSAGE,
    };
  }

  const permission = currentPermission();

  if (permission === 'denied') {
    return {
      state: 'blocked',
      permission,
      hasSubscription: false,
      hasServerSubscription: false,
      message: BLOCKED_MESSAGE,
    };
  }

  if (permission === 'default') {
    return {
      state: 'not_enabled',
      permission,
      hasSubscription: false,
      hasServerSubscription: false,
    };
  }

  // Permission is granted — check for a working subscription.
  const subscription = await getExistingSubscription();
  const hasSubscription = Boolean(subscription);
  const hasServerSubscription = await checkServerSubscription();

  if (hasSubscription && hasServerSubscription) {
    return {
      state: 'enabled',
      permission,
      hasSubscription,
      hasServerSubscription,
      message: ENABLED_MESSAGE,
    };
  }

  // Permission granted but subscription is missing — needs reconnect.
  return {
    state: 'setup_incomplete',
    permission,
    hasSubscription,
    hasServerSubscription,
    message: SETUP_INCOMPLETE_MESSAGE,
  };
}

/**
 * The full Enable flow, run only after the student presses the button. Returns the
 * state to display plus the message to show. A refusal never leaves a subscription
 * behind and never schedules pushes. Includes a 10-second timeout so the button can
 * never get stuck loading.
 */
export async function enableNotifications(): Promise<PushStatus> {
  if (!isPushSupported()) {
    return {
      state: 'unsupported',
      permission: 'unsupported',
      hasSubscription: false,
      hasServerSubscription: false,
      message: UNSUPPORTED_MESSAGE,
    };
  }

  let permission = currentPermission();

  if (permission === 'denied') {
    return {
      state: 'blocked',
      permission,
      hasSubscription: false,
      hasServerSubscription: false,
      message: BLOCKED_MESSAGE,
    };
  }

  // Only ask the browser when it has not already been asked (or granted).
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission === 'denied') {
    return {
      state: 'blocked',
      permission,
      hasSubscription: false,
      hasServerSubscription: false,
      message: BLOCKED_MESSAGE,
    };
  }

  if (permission !== 'granted') {
    return {
      state: 'not_enabled',
      permission,
      hasSubscription: false,
      hasServerSubscription: false,
    };
  }

  // Run the subscription flow with a timeout so the button never gets stuck.
  let saved: boolean;
  try {
    saved = await Promise.race([
      createAndSaveSubscription(),
      timeout(ENABLE_TIMEOUT_MS, 'Setting up notifications is taking too long. Please try again.'),
    ]);
  } catch (e) {
    return {
      state: 'setup_incomplete',
      permission,
      hasSubscription: false,
      hasServerSubscription: false,
      message: e instanceof Error ? e.message : 'Could not complete notification setup. Please try again.',
    };
  }

  if (!saved) {
    return {
      state: 'setup_incomplete',
      permission,
      hasSubscription: false,
      hasServerSubscription: false,
      message: SETUP_INCOMPLETE_MESSAGE,
    };
  }

  await setPushPreference(true);
  return {
    state: 'enabled',
    permission,
    hasSubscription: true,
    hasServerSubscription: true,
    message: ENABLED_MESSAGE,
  };
}

/**
 * Turn TaskTrack notifications off. The subscription is removed on the server (so no
 * further pushes are scheduled for this device) and unsubscribed in the browser.
 * Browser permission itself is left unchanged — the user controls that in browser settings.
 */
export async function disableNotifications(): Promise<PushStatus> {
  const { data: auth } = await supabase.auth.getUser();

  const subscription = await getExistingSubscription();
  if (subscription) {
    const endpoint = subscription.endpoint;
    try {
      await subscription.unsubscribe();
    } catch {
      // Even if the browser refuses, the server row is removed below.
    }
    if (auth?.user) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
  }

  await setPushPreference(false);

  const permission = currentPermission();
  if (permission === 'denied') {
    return {
      state: 'blocked',
      permission,
      hasSubscription: false,
      hasServerSubscription: false,
      message: BLOCKED_MESSAGE,
    };
  }
  return {
    state: 'not_enabled',
    permission,
    hasSubscription: false,
    hasServerSubscription: false,
    message: 'Notifications are turned off. You can enable them again at any time.',
  };
}

export interface TestResult {
  ok: boolean;
  message: string;
}

/**
 * Ask the server to deliver one real push to this student's devices. Only works once
 * permission has been granted and a subscription is saved; if it has not, this
 * explains that notifications must be enabled first rather than pretending to send.
 */
export async function sendTestNotification(): Promise<TestResult> {
  if (!isPushSupported()) {
    return { ok: false, message: UNSUPPORTED_MESSAGE };
  }
  if (currentPermission() !== 'granted') {
    return {
      ok: false,
      message: 'Enable Study Notifications first, then you can send a test notification.',
    };
  }
  const subscription = await getExistingSubscription();
  if (!subscription) {
    return {
      ok: false,
      message: 'Enable Study Notifications first, then you can send a test notification.',
    };
  }

  const { data: { session } } = await supabase.auth.getSession();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !session) {
    return { ok: false, message: 'Could not send the test notification. Please try again.' };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/functions/v1/send-study-notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        Apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify({ action: 'test' }),
    });
  } catch {
    return { ok: false, message: 'Could not reach the notification service. Check your connection.' };
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    const errMsg =
      (typeof body?.error === 'string' && body.error) ||
      'We could not send a test notification. Check the notification setup and try again.';
    return { ok: false, message: errMsg };
  }

  return {
    ok: true,
    message:
      body.delivered > 0
        ? 'Test notification sent. It should appear in a moment.'
        : 'No active device received the test notification. Try enabling notifications again on this device.',
  };
}

/**
 * Clean up a stale subscription when the browser reports the endpoint is gone. The
 * row is deleted rather than left to fail on every sweep.
 */
export async function removeStaleSubscription(endpoint: string): Promise<void> {
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}
