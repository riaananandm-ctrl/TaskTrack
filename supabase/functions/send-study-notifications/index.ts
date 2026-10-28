import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * TaskTrack study notification sender.
 *
 * Two ways in:
 *  - Sweep (no body action): called every minute by the pg_cron job, which presents
 *    the shared cron secret in `x-cron-secret`. It claims due reminders atomically,
 *    sends a Web Push to each owner's active devices, marks them sent, and retires
 *    dead subscriptions.
 *  - Test (`{ action: "test" }`): called from Settings with the student's own token.
 *    It sends one notification to that student's own devices only.
 *
 * Security:
 *  - The VAPID private key and the cron secret live in the `push_config` table, readable
 *    only by the service role. They are never returned to a browser and never logged.
 *  - A sweep is only allowed with a valid cron secret. A test is only allowed with a
 *    verified user token, and only ever targets that user's subscriptions.
 *  - Reminders and subscriptions are always matched on user_id, so no student can
 *    receive another student's reminder.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface PushConfig {
  vapid_public: string;
  vapid_private: string;
  cron_secret: string;
  subject: string;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface ClaimedReminder {
  reminder_id: string;
  user_id: string;
  title: string;
  message: string | null;
  scheduled_for: string;
  task_id: string | null;
  session_id: string | null;
  task_title: string | null;
  duration_minutes: number | null;
  reminder_type: string;
  push_enabled: boolean;
  endpoint: string | null;
  p256dh: string | null;
  sub_auth: string | null;
}

/** Compose the reminder notification exactly as the student should read it. */
function buildMessage(row: ClaimedReminder): { title: string; body: string; tag: string } {
  const title = 'TaskTrack study reminder';

  // "Math Test on Logarithms — Review logarithm laws · 30 minutes"
  const taskName = (row.task_title || row.title || 'Your study session').trim();
  const purpose = (row.message || '').trim();
  const minutes = row.duration_minutes;

  let body = taskName;
  if (purpose) body += ` — ${purpose}`;
  if (typeof minutes === 'number' && minutes > 0) body += ` · ${minutes} minutes`;
  if (row.reminder_type === 'study_session') {
    body += ` · Starting now`;
  }

  return { title, body, tag: `reminder-${row.reminder_id}` };
}

function encodeBase64Url(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build the Authorization header that proves this send came from TaskTrack. */
async function vapidAuthHeader(
  config: PushConfig,
  audience: string
): Promise<string> {
  const header = encodeBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = encodeBase64Url(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: config.subject,
    })
  );
  const signingInput = `${header}.${payload}`;

  const key = await importVapidKey(config.vapid_private);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(signingInput)
    )
  );

  const sigB64 = btoa(String.fromCharCode(...signature))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `vapid t=${signingInput}.${sigB64}, k=${config.vapid_public}`;
}

/**
 * Import the raw private VAPID key as a Web Crypto signing key. The stored value is
 * the 32-byte private scalar in base64url; Web Crypto wants it wrapped in a JWK with
 * the matching public point.
 */
async function importVapidKey(privateB64Url: string): Promise<CryptoKey> {
  const privateBytes = base64UrlToBytes(privateB64Url);
  // The public point is derived by the sender function's config; the JWK needs x/y.
  const publicKey = await derivePublicPoint(privateB64Url);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: privateB64Url,
    x: publicKey.x,
    y: publicKey.y,
    ext: true,
  };
  void privateBytes;
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
}

function base64UrlToBytes(input: string): Uint8Array {
  const padding = '='.repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Derive the public key point for the private scalar using a throwaway JWK import:
 * Web Crypto can export the derived public point from a full JWK with x and y. We
 * instead compute it from the stored public key string when available; the sender
 * passes the whole config so the public point is taken from `vapid_public`.
 */
let cachedPublicPoint: { x: string; y: string } | null = null;
function setPublicPoint(publicB64Url: string): void {
  const bytes = base64UrlToBytes(publicB64Url);
  // Uncompressed point: 0x04 || X (32) || Y (32)
  const x = bytes.slice(1, 33);
  const y = bytes.slice(33, 65);
  cachedPublicPoint = { x: bytesToBase64Url(x), y: bytesToBase64Url(y) };
}
async function derivePublicPoint(_privateB64Url: string): Promise<{ x: string; y: string }> {
  if (!cachedPublicPoint) throw new Error('VAPID public point not initialised');
  return cachedPublicPoint;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Send one Web Push message and translate the response into a delivery outcome. */
async function sendPush(
  config: PushConfig,
  sub: SubscriptionRow,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; gone: boolean }> {
  const audience = new URL(sub.endpoint).origin;
  const authorization = await vapidAuthHeader(config, audience);

  let res: Response;
  try {
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        TTL: '3600',
        Urgency: 'high',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, gone: false };
  }

  // 404/410 mean the subscription no longer exists and should be retired.
  if (res.status === 404 || res.status === 410) return { ok: false, gone: true };
  return { ok: res.ok, gone: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ ok: false, error: 'Notification service is not configured.' }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: configRow, error: configError } = await admin
      .from('push_config')
      .select('vapid_public, vapid_private, cron_secret, subject')
      .eq('id', 1)
      .maybeSingle();
    if (configError || !configRow) {
      return json({ ok: false, error: 'Notification service is not configured.' }, 503);
    }
    const config = configRow as PushConfig;
    setPublicPoint(config.vapid_public);

    const rawBody = await req.text();
    const body = rawBody ? JSON.parse(rawBody) : {};
    const isTest = body?.action === 'test';

    // ---- Test notification: authenticated student, own devices only ----
    if (isTest) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return json({ ok: false, error: 'Please sign in again to send a test notification.' }, 401);
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData?.user) {
        return json({ ok: false, error: 'Please sign in again to send a test notification.' }, 401);
      }

      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', userData.user.id)
        .is('disabled_at', null);

      if (!subs || subs.length === 0) {
        return json({ ok: true, delivered: 0 });
      }

      let delivered = 0;
      for (const sub of subs as SubscriptionRow[]) {
        const result = await sendPush(config, sub, {
          title: 'TaskTrack study reminder',
          body: 'This is a test notification. Your study reminders will look like this.',
          taskId: null,
          sessionId: null,
          tag: 'tasktrack-test',
        });
        if (result.ok) delivered += 1;
        if (result.gone) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }

      return json({ ok: true, delivered });
    }

    // ---- Sweep: only with a valid cron secret ----
    const cronSecret = req.headers.get('x-cron-secret');
    if (!cronSecret || cronSecret !== config.cron_secret) {
      return json({ ok: false, error: 'Not authorised.' }, 401);
    }

    const { data: claimed, error: claimError } = await admin.rpc('claim_due_push_reminders', {
      batch_size: 25,
    });
    if (claimError) {
      return json({ ok: false, error: 'Could not load due reminders.' }, 500);
    }

    const rows = (claimed ?? []) as ClaimedReminder[];
    let sent = 0;
    let skipped = 0;

    for (const row of rows) {
      // Nothing to do when the student has notifications off or no live device.
      if (!row.push_enabled || !row.endpoint || !row.p256dh || !row.sub_auth) {
        await admin
          .from('reminders')
          .update({ push_sent_at: new Date().toISOString(), push_claimed_at: null })
          .eq('id', row.reminder_id);
        skipped += 1;
        continue;
      }

      const message = buildMessage(row);
      const result = await sendPush(
        config,
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.sub_auth },
        {
          title: message.title,
          body: message.body,
          taskId: row.task_id,
          sessionId: row.session_id,
          tag: message.tag,
        }
      );

      if (result.ok) {
        sent += 1;
        await admin
          .from('reminders')
          .update({ push_sent_at: new Date().toISOString(), push_claimed_at: null })
          .eq('id', row.reminder_id);
        await admin
          .from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq('endpoint', row.endpoint);
      } else if (result.gone) {
        // The device is gone: remove its subscription so it is never tried again.
        await admin.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
        await admin
          .from('reminders')
          .update({ push_sent_at: new Date().toISOString(), push_claimed_at: null })
          .eq('id', row.reminder_id);
      } else {
        // A transient failure: release the claim so it can be retried, and let the
        // attempt counter retire it after a few tries.
        await admin
          .from('reminders')
          .update({ push_claimed_at: null })
          .eq('id', row.reminder_id);
      }
    }

    return json({ ok: true, sent, skipped, claimed: rows.length });
  } catch (err) {
    console.error('Study notification sweep failed:', err instanceof Error ? err.message : 'unknown');
    return json({ ok: false, error: 'The study notification sweep failed.' }, 500);
  }
});
