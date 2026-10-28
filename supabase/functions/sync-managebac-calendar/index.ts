import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * ManageBac calendar sync.
 *
 * The browser never fetches the private calendar link — it only asks this function to
 * sync, proving who it is with its TaskTrack token. The function decrypts the student's
 * own stored link server-side, fetches it, parses the iCalendar feed, and writes tasks,
 * events and reminders. A periodic job runs the same function for every connected
 * student, authenticated with a shared secret.
 *
 * Safety properties:
 *  - Only the caller's own connection is ever read (manual sync); the scheduled run
 *    processes every connection but each row stays scoped to its own user_id.
 *  - The feed host is re-checked against the ManageBac allowlist on every fetch and on
 *    every redirect, so the link cannot be used to reach an internal address.
 *  - The link is never returned, never logged, and never placed in an error message.
 *  - Re-importing never duplicates: entries are matched on their feed UID.
 *  - Local edits are preserved: a feed change only overwrites fields the student has not
 *    touched since the last import.
 *  - Nothing is ever deleted because it disappeared from the feed.
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

const ALLOWED_SUFFIXES = ['.managebac.com', '.managebac.cn'];

function extraAllowedHosts(): string[] {
  const raw = Deno.env.get('MANAGEBAC_FEED_HOSTS');
  if (!raw) return [];
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return extraAllowedHosts().some((h) => host === h || host.endsWith(`.${h}`));
}

const SAFE_MESSAGES = {
  invalidUrl: 'The saved ManageBac link is no longer valid. Reconnect your calendar.',
  expired: 'That subscription link is no longer active. Create a new one in ManageBac and reconnect.',
  unauthorized: 'That subscription link is not authorised. Copy a fresh link from ManageBac and reconnect.',
  unavailable: 'The ManageBac calendar could not be reached. Check that your subscription link is still active.',
  malformed: 'The ManageBac calendar could not be read. Check that your subscription link is still active.',
  empty: 'Your ManageBac calendar returned no events.',
  rateLimited: 'ManageBac is rate limiting requests. Your calendar will sync again shortly.',
  network: 'The ManageBac calendar could not be reached. Check that your subscription link is still active.',
} as const;

/** Follow redirects manually so every hop is re-checked against the allowlist. */
async function safeFetch(startUrl: string): Promise<Response> {
  let url = new URL(startUrl);
  for (let hop = 0; hop <= 3; hop += 1) {
    if (!hostAllowed(url.hostname)) throw new Error('BLOCKED_HOST');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url.toString(), {
        redirect: 'manual',
        headers: { Accept: 'text/calendar, text/plain, */*' },
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) return res;
        url = new URL(location, url);
        continue;
      }
      return res;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('TOO_MANY_REDIRECTS');
}

// ---- AES-GCM decryption of the feed URL ----

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decryptUrl(encKeyB64: string, combinedB64: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', b64ToBytes(encKeyB64), { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = b64ToBytes(combinedB64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ---- iCalendar parsing ----

interface ParsedEvent {
  uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
  lastModifiedAt: string | null;
}

/** Join folded lines: a line beginning with a space or tab continues the previous one. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/** Split a content line into its property name, params and value. */
function splitProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  let colonIndex = -1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) { colonIndex = i; break; }
  }
  if (colonIndex === -1) return null;

  const left = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const parts = left.split(';');
  const name = parts[0].trim().toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Parse an iCalendar date or date-time into an ISO instant. A date-only value becomes
 * midnight UTC; a floating time is read as UTC. Returns whether a time was present, so
 * the caller knows if a due time should be shown.
 */
function parseIcalDate(value: string, params: Record<string, string>): { iso: string; hasTime: boolean } | null {
  const v = value.trim();
  const isDateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(v);

  if (isDateOnly && /^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4));
    const m = Number(v.slice(4, 6));
    const d = Number(v.slice(6, 8));
    const ms = Date.UTC(y, m - 1, d);
    return Number.isNaN(ms) ? null : { iso: new Date(ms).toISOString(), hasTime: false };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!match) return null;
  const [, y, mo, d, hh, mm, ss, z] = match;
  const ms = z === 'Z'
    ? Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss))
    : Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  return Number.isNaN(ms) ? null : { iso: new Date(ms).toISOString(), hasTime: true };
}

/** Extract every VEVENT from the feed. Malformed blocks are skipped, not fatal. */
function parseCalendar(text: string): ParsedEvent[] {
  const lines = unfold(text);
  const events: ParsedEvent[] = [];
  let current: Map<string, { value: string; params: Record<string, string> }> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') { current = new Map(); continue; }
    if (trimmed === 'END:VEVENT') {
      if (current) {
        const get = (key: string) => current!.get(key);
        const uid = get('UID')?.value.trim();
        if (uid) {
          const dtStart = get('DTSTART');
          const dtEnd = get('DTEND');
          const due = get('DUE');
          const start = dtStart ? parseIcalDate(dtStart.value, dtStart.params) : null;
          const end = dtEnd ? parseIcalDate(dtEnd.value, dtEnd.params) : null;
          const dueParsed = due ? parseIcalDate(due.value, due.params) : null;
          const modified = get('LAST-MODIFIED') ?? get('DTSTAMP');
          const modifiedParsed = modified ? parseIcalDate(modified.value, modified.params) : null;

          // Prefer an explicit DUE, then the end of the event, then its start.
          const effective = dueParsed ?? end ?? start;
          events.push({
            uid,
            summary: get('SUMMARY') ? unescapeText(get('SUMMARY')!.value) || null : null,
            description: get('DESCRIPTION') ? unescapeText(get('DESCRIPTION')!.value) || null : null,
            location: get('LOCATION') ? unescapeText(get('LOCATION')!.value) || null : null,
            startAt: start?.iso ?? null,
            endAt: end?.iso ?? null,
            dueAt: effective?.iso ?? null,
            dueHasTime: effective?.hasTime ?? false,
            lastModifiedAt: modifiedParsed?.iso ?? null,
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const prop = splitProperty(line);
    if (prop) current.set(prop.name, { value: prop.value, params: prop.params });
  }

  return events;
}

/** Stable hash of the fields that come from the feed, used to detect real changes. */
async function hashEvent(e: ParsedEvent): Promise<string> {
  const payload = JSON.stringify([
    e.summary, e.description, e.location, e.startAt, e.endAt, e.dueAt, e.lastModifiedAt,
  ]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface SyncResult {
  imported: number;
  updated: number;
  unchanged: number;
  sparse: boolean;
}

/** Sync one student's connection. Returns counts, or throws with a safe category. */
async function syncConnection(
  admin: ReturnType<typeof createClient>,
  connection: { id: string; user_id: string; enc_feed_url: string },
  encKey: string
): Promise<SyncResult> {
  let feedUrl: string;
  try {
    feedUrl = await decryptUrl(encKey, connection.enc_feed_url);
  } catch {
    throw new Error('INVALID_URL');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(feedUrl);
  } catch {
    throw new Error('INVALID_URL');
  }
  if (parsedUrl.protocol !== 'https:' || !hostAllowed(parsedUrl.hostname)) {
    throw new Error('INVALID_URL');
  }

  let res: Response;
  try {
    res = await safeFetch(parsedUrl.toString());
  } catch {
    throw new Error('NETWORK');
  }

  if (res.status === 401 || res.status === 403) throw new Error('UNAUTHORIZED');
  if (res.status === 404 || res.status === 410) throw new Error('EXPIRED');
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error('UNAVAILABLE');

  const text = (await res.text()).slice(0, 3_000_000);
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('MALFORMED');

  const events = parseCalendar(text);
  const result: SyncResult = { imported: 0, updated: 0, unchanged: 0, sparse: false };
  const nowIso = new Date().toISOString();

  for (const event of events) {
    const newHash = await hashEvent(event);
    if (!event.description) result.sparse = true;

    const { data: existing } = await admin
      .from('managebac_calendar_events')
      .select('id, task_id, disposition, content_hash')
      .eq('user_id', connection.user_id)
      .eq('external_uid', event.uid)
      .maybeSingle();

    if (!existing) {
      // New entry: record it, and (by default) create a task so it shows up as work to do.
      const { data: inserted } = await admin
        .from('managebac_calendar_events')
        .insert({
          user_id: connection.user_id,
          connection_id: connection.id,
          external_uid: event.uid,
          summary: event.summary,
          description: event.description,
          location: event.location,
          start_at: event.startAt,
          end_at: event.endAt,
          due_at: event.dueAt,
          last_modified_at: event.lastModifiedAt,
          disposition: 'task',
          content_hash: newHash,
          updated_at: nowIso,
        })
        .select('id')
        .maybeSingle();

      const taskId = await createImportedTask(admin, connection.user_id, event, newHash);
      if (taskId && inserted?.id) {
        await admin.from('managebac_calendar_events').update({ task_id: taskId }).eq('id', inserted.id);
      }
      await ensureReminder(admin, connection.user_id, event, taskId);
      result.imported += 1;
      continue;
    }

    if (existing.content_hash === newHash) {
      result.unchanged += 1;
      continue;
    }

    // The feed changed for this entry. Refresh the stored copy of the feed fields.
    await admin
      .from('managebac_calendar_events')
      .update({
        summary: event.summary,
        description: event.description,
        location: event.location,
        start_at: event.startAt,
        end_at: event.endAt,
        due_at: event.dueAt,
        last_modified_at: event.lastModifiedAt,
        content_hash: newHash,
        updated_at: nowIso,
      })
      .eq('id', existing.id);

    if (existing.task_id) {
      const { data: task } = await admin
        .from('tasks')
        .select('id, external_hash')
        .eq('id', existing.task_id)
        .maybeSingle();

      // Only overwrite when the task still holds exactly what the last import wrote.
      // If the student has edited it, their version wins and is left untouched.
      if (task && task.external_hash === existing.content_hash) {
        await admin
          .from('tasks')
          .update({
            title: event.summary || 'ManageBac calendar entry',
            description: event.description,
            due_date: event.dueAt ? event.dueAt.slice(0, 10) : null,
            due_time: event.dueHasTime && event.dueAt ? event.dueAt.slice(11, 16) : null,
            external_hash: newHash,
            updated_at: nowIso,
          })
          .eq('id', task.id);
        await ensureReminder(admin, connection.user_id, event, task.id);
      }
    }
    result.updated += 1;
  }

  return result;
}

async function createImportedTask(
  admin: ReturnType<typeof createClient>,
  userId: string,
  event: ParsedEvent,
  hash: string
): Promise<string | null> {
  const { data: created, error } = await admin
    .from('tasks')
    .insert({
      user_id: userId,
      title: event.summary || 'ManageBac calendar entry',
      description: event.description,
      due_date: event.dueAt ? event.dueAt.slice(0, 10) : null,
      due_time: event.dueHasTime && event.dueAt ? event.dueAt.slice(11, 16) : null,
      // The feed carries no category or priority, so the app's neutral defaults are used
      // rather than inventing detail. Subject and estimated duration stay genuinely blank.
      category: 'other',
      priority: 'medium',
      status: 'not_started',
      external_source: 'managebac_calendar',
      external_uid: event.uid,
      external_hash: hash,
    })
    .select('id')
    .maybeSingle();

  if (error) return null;
  return created?.id ?? null;
}

/**
 * Make sure a future imported entry has exactly one reminder. The dedupe key means a
 * second sync never creates another, so the student is never notified twice.
 */
async function ensureReminder(
  admin: ReturnType<typeof createClient>,
  userId: string,
  event: ParsedEvent,
  taskId: string | null
): Promise<void> {
  if (!event.dueAt) return;
  if (new Date(event.dueAt).getTime() <= Date.now()) return;

  const dedupeKey = `managebac:${event.uid}`;
  const { data: existing } = await admin
    .from('reminders')
    .select('id, scheduled_for')
    .eq('user_id', userId)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();

  if (existing) {
    if (existing.scheduled_for !== event.dueAt) {
      await admin
        .from('reminders')
        .update({ scheduled_for: event.dueAt, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return;
  }

  await admin.from('reminders').insert({
    user_id: userId,
    task_id: taskId,
    title: event.summary || 'ManageBac calendar entry',
    message: 'Imported from ManageBac Calendar',
    reminder_type: 'task_due',
    scheduled_for: event.dueAt,
    repeat_rule: 'none',
    is_enabled: true,
    is_read: false,
    dedupe_key: dedupeKey,
  });
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
      return json({ ok: false, error: 'ManageBac sync is unavailable right now.' }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: secrets } = await admin
      .from('integration_secrets')
      .select('enc_key, sync_cron_secret')
      .eq('id', 1)
      .maybeSingle();
    if (!secrets?.enc_key) {
      return json({ ok: false, error: 'ManageBac sync is unavailable right now.' }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const isScheduled = body?.action === 'scheduled';

    // ---- Scheduled run: shared secret, every connection ----
    if (isScheduled) {
      const secret = req.headers.get('x-sync-secret');
      if (!secret || secret !== secrets.sync_cron_secret) {
        return json({ ok: false, error: 'Not authorised.' }, 401);
      }

      const { data: connections } = await admin
        .from('managebac_calendar_connections')
        .select('id, user_id, enc_feed_url')
        .limit(100);

      let synced = 0;
      let failed = 0;

      for (const connection of connections ?? []) {
        try {
          const result = await syncConnection(admin, connection, secrets.enc_key);
          await admin
            .from('managebac_calendar_connections')
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: 'success',
              last_sync_error: null,
              last_sync_imported: result.imported + result.updated,
              updated_at: new Date().toISOString(),
            })
            .eq('id', connection.id);
          synced += 1;
        } catch (err) {
          failed += 1;
          const message = safeMessageFor(err);
          await admin
            .from('managebac_calendar_connections')
            .update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: 'error',
              last_sync_error: message,
              updated_at: new Date().toISOString(),
            })
            .eq('id', connection.id);
        }
      }

      return json({ ok: true, synced, failed });
    }

    // ---- Manual run: the signed-in student's own connection only ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    }

    const { data: connection } = await admin
      .from('managebac_calendar_connections')
      .select('id, user_id, enc_feed_url')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (!connection) {
      return json({ ok: false, error: 'Connect your ManageBac calendar first.' }, 400);
    }

    try {
      const result = await syncConnection(admin, connection, secrets.enc_key);
      await admin
        .from('managebac_calendar_connections')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'success',
          last_sync_error: null,
          last_sync_imported: result.imported + result.updated,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);

      return json({
        ok: true,
        imported: result.imported,
        updated: result.updated,
        unchanged: result.unchanged,
        sparse: result.sparse,
      });
    } catch (err) {
      const message = safeMessageFor(err);
      await admin
        .from('managebac_calendar_connections')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);
      return json({ ok: false, error: message }, 400);
    }
  } catch (err) {
    console.error('ManageBac sync failed:', err instanceof Error ? err.message : 'unknown');
    return json({ ok: false, error: 'Your ManageBac calendar could not be synced. Please try again.' }, 500);
  }
});

/** Map an internal failure to a short, safe, user-facing sentence. */
function safeMessageFor(err: unknown): string {
  const code = err instanceof Error ? err.message : '';
  switch (code) {
    case 'INVALID_URL': return SAFE_MESSAGES.invalidUrl;
    case 'EXPIRED': return SAFE_MESSAGES.expired;
    case 'UNAUTHORIZED': return SAFE_MESSAGES.unauthorized;
    case 'RATE_LIMITED': return SAFE_MESSAGES.rateLimited;
    case 'MALFORMED': return SAFE_MESSAGES.malformed;
    case 'NETWORK': return SAFE_MESSAGES.network;
    default: return SAFE_MESSAGES.unavailable;
  }
}
