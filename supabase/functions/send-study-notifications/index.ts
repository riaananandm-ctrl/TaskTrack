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
 * "Due tomorrow" reminders (reminder_type 'task_due_tomorrow', created by a database
 * trigger the day before a task is due) are also emailed. Set ONE provider as Edge
 * Function secrets:
 *  - Brevo (free, no domain needed): BREVO_API_KEY + REMINDER_EMAIL_FROM, where the
 *    from address is a sender verified in Brevo, e.g. "TaskTrack <you@gmail.com>".
 *  - Resend (needs your own domain): RESEND_API_KEY + REMINDER_EMAIL_FROM.
 *  - APP_URL is optional; links default to https://tasktrackbm.vercel.app.
 * Without a provider, email is skipped (and logged once per sweep) and push still works.
 *
 * Push payloads are encrypted (RFC 8291, aes128gcm). Push services drop unencrypted
 * payloads, which made every notification fall back to the generic service-worker text.
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
  if (row.reminder_type === 'task_due_tomorrow') {
    const name = (row.task_title || row.title.replace(/^Due tomorrow:\s*/, '') || 'A task').trim();
    return {
      title: `Due tomorrow: ${name}`,
      body: `"${name}" is due tomorrow. Tap to open it in TaskTrack.`,
      tag: `due-tomorrow-${row.task_id ?? row.reminder_id}`,
    };
  }

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

// ---- Web Push payload encryption (RFC 8291 / RFC 8188, aes128gcm) ----

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** Encrypt a payload for one subscription. Returns the complete aes128gcm body. */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dhB64Url: string,
  authB64Url: string
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const uaPublic = base64UrlToBytes(p256dhB64Url);
  const authSecret = base64UrlToBytes(authB64Url);

  // One-off sender key pair, as the spec requires a fresh key per message.
  const asKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256)
  );

  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // Single record: payload followed by the 0x02 "last record" delimiter.
  const padded = concatBytes(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  // Header: salt (16) | record size (uint32, 4096) | key id length (1) | sender public key.
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concatBytes(header, ciphertext);
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
    const body = await encryptPayload(
      new TextEncoder().encode(JSON.stringify(payload)),
      sub.p256dh,
      sub.auth
    );
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: '86400',
        Urgency: 'high',
      },
      body,
    });
  } catch {
    return { ok: false, gone: false };
  }

  // 404/410 mean the subscription no longer exists and should be retired.
  if (res.status === 404 || res.status === 410) return { ok: false, gone: true };
  return { ok: res.ok, gone: false };
}

// ---- "Due tomorrow" email ----

const DEFAULT_APP_URL = 'https://tasktrackbm.vercel.app';

interface EmailProvider {
  kind: 'brevo' | 'resend';
  apiKey: string;
  fromName: string;
  fromEmail: string;
}

/** The configured email service, or null. Brevo is preferred because it needs no domain. */
function emailProvider(): EmailProvider | null {
  const from = (Deno.env.get('REMINDER_EMAIL_FROM') || '').trim();
  if (!from) return null;
  // Accept "Name <email>" or a bare email address.
  const match = from.match(/^\s*(.*?)\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/);
  const fromEmail = match ? match[2] : from;
  const fromName = (match && match[1].replace(/^"|"$/g, '')) || 'TaskTrack';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) return null;
  const brevo = Deno.env.get('BREVO_API_KEY');
  if (brevo) return { kind: 'brevo', apiKey: brevo, fromName, fromEmail };
  const resend = Deno.env.get('RESEND_API_KEY');
  if (resend) return { kind: 'resend', apiKey: resend, fromName, fromEmail };
  return null;
}

/** Send one email through the configured provider. Never logs the key or the address. */
async function deliverEmail(
  provider: EmailProvider,
  to: string,
  toName: string,
  subject: string,
  html: string,
  text: string
): Promise<boolean> {
  try {
    const res =
      provider.kind === 'brevo'
        ? await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': provider.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              sender: { name: provider.fromName, email: provider.fromEmail },
              to: [toName ? { email: to, name: toName } : { email: to }],
              subject,
              htmlContent: html,
              textContent: text,
            }),
            signal: AbortSignal.timeout(15_000),
          })
        : await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: `${provider.fromName} <${provider.fromEmail}>`,
              to: [to],
              subject,
              html,
              text,
            }),
            signal: AbortSignal.timeout(15_000),
          });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200).replace(/[^\s@]+@[^\s@]+/g, '[email]');
      console.error(`Reminder email failed (${provider.kind}) with status`, res.status, detail);
      return false;
    }
    return true;
  } catch {
    console.error(`Reminder email request failed (${provider.kind})`);
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Email a "due tomorrow" reminder once. Skipped silently when email is not configured,
 * the student turned email off, there is no address, or it was already sent.
 */
async function sendDueTomorrowEmail(
  admin: ReturnType<typeof createClient>,
  row: ClaimedReminder
): Promise<boolean> {
  const provider = emailProvider();
  if (!provider) return false;

  const [{ data: reminder }, { data: profile }, { data: settings }, { data: task }] = await Promise.all([
    admin.from('reminders').select('email_sent_at, is_enabled').eq('id', row.reminder_id).maybeSingle(),
    admin.from('profiles').select('email, full_name').eq('id', row.user_id).maybeSingle(),
    admin.from('user_settings').select('email_reminders_enabled').eq('user_id', row.user_id).limit(1).maybeSingle(),
    row.task_id
      ? admin.from('tasks').select('title, due_date, due_time, status, subject:subjects(name)').eq('id', row.task_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!reminder || reminder.email_sent_at || !reminder.is_enabled) return false;
  if (settings && settings.email_reminders_enabled === false) return false;
  const to = typeof profile?.email === 'string' ? profile.email.trim() : '';
  if (!to) return false;
  if (task && task.status === 'completed') return false;

  const name = (task?.title || row.task_title || row.title.replace(/^Due tomorrow:\s*/, '') || 'A task').trim();
  const subject = (task?.subject as { name?: string } | null)?.name ?? null;
  let when = 'tomorrow';
  if (task?.due_date) {
    const d = new Date(`${task.due_date}T00:00:00Z`);
    when = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    if (task.due_time) when += ` at ${String(task.due_time).slice(0, 5)}`;
  }
  const firstName = typeof profile?.full_name === 'string' ? profile.full_name.split(' ')[0] : '';
  const appUrl = (Deno.env.get('APP_URL') || DEFAULT_APP_URL).replace(/\/+$/, '');
  const taskLink = appUrl && row.task_id ? `${appUrl}/app/tasks?task=${encodeURIComponent(row.task_id)}` : appUrl ? `${appUrl}/app` : '';
  const settingsLink = appUrl ? `${appUrl}/app/settings` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif;color:#202a3b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e6eb">
<tr><td style="background:#17264b;padding:20px 24px;color:#ffffff;font-size:13px;letter-spacing:1px;text-transform:uppercase;font-weight:bold">TaskTrack reminder</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:15px">${firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,'}</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">This is due <strong>tomorrow</strong>:</p>
<div style="border-left:4px solid #315edb;background:#f0f4ff;border-radius:8px;padding:14px 16px;margin:0 0 20px">
<div style="font-size:17px;font-weight:bold;margin:0 0 4px">${escapeHtml(name)}</div>
<div style="font-size:13px;color:#647084">${subject ? `${escapeHtml(subject)} &middot; ` : ''}Due ${escapeHtml(when)}</div>
</div>
${taskLink ? `<a href="${escapeHtml(taskLink)}" style="display:inline-block;background:#315edb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 20px;border-radius:10px">Open in TaskTrack</a>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e3e6eb;font-size:12px;color:#647084;line-height:1.5">
You are getting this because you have a task due tomorrow in TaskTrack.${settingsLink ? ` <a href="${escapeHtml(settingsLink)}" style="color:#647084">Turn off reminder emails</a> in Settings.` : ' You can turn off reminder emails in Settings.'}
</td></tr></table></td></tr></table></body></html>`;

  const text = `${firstName ? `Hi ${firstName},\n\n` : ''}Due tomorrow: ${name}${subject ? ` (${subject})` : ''}\nDue ${when}\n${taskLink ? `\nOpen it in TaskTrack: ${taskLink}\n` : ''}\nYou can turn off reminder emails in TaskTrack Settings.`;

  const emailSubject = `Due tomorrow: ${name}`;
  if (!(await deliverEmail(provider, to, firstName, emailSubject, html, text))) return false;

  await admin.from('reminders').update({ email_sent_at: new Date().toISOString() }).eq('id', row.reminder_id);
  return true;
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
    let emailed = 0;
    const emailHandled = new Set<string>();
    if (!emailProvider() && rows.some((r) => r.reminder_type === 'task_due_tomorrow')) {
      console.error('Reminder emails are off: set BREVO_API_KEY (or RESEND_API_KEY) and REMINDER_EMAIL_FROM.');
    }

    for (const row of rows) {
      // Email is independent of push: a student with no device registered still gets it.
      // One claimed row exists per device, so each reminder is emailed only once.
      if (row.reminder_type === 'task_due_tomorrow' && !emailHandled.has(row.reminder_id)) {
        emailHandled.add(row.reminder_id);
        if (await sendDueTomorrowEmail(admin, row)) emailed += 1;
      }

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

    return json({ ok: true, sent, skipped, emailed, claimed: rows.length });
  } catch (err) {
    console.error('Study notification sweep failed:', err instanceof Error ? err.message : 'unknown');
    return json({ ok: false, error: 'The study notification sweep failed.' }, 500);
  }
});
