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

// Keyword priority rules. KEEP IN SYNC with lib/auto-priority.ts in the web app.
// Highest match wins: Summative -> urgent, Formative -> high, "Task 3" -> medium.
function autoPriority(title: string | null | undefined): 'urgent' | 'high' | 'medium' {
  const t = title ?? '';
  if (/\bsummative\b/i.test(t)) return 'urgent';
  if (/\bformative\b/i.test(t)) return 'high';
  return 'medium'; // "Task 3" and everything else.
}

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
  newChanges: number;
}

/** Feed fields we track, with student-facing labels for the change inbox. */
const TRACKED_FIELDS: Array<{ field: keyof ParsedEvent; label: string }> = [
  { field: 'summary', label: 'Title' },
  { field: 'description', label: 'Details' },
  { field: 'dueAt', label: 'Due' },
  { field: 'startAt', label: 'Starts' },
  { field: 'endAt', label: 'Ends' },
  { field: 'location', label: 'Location' },
];

/** Field-by-field diff between the stored copy and the new feed copy. */
function diffEvents(
  previous: Record<string, unknown>,
  next: ParsedEvent
): Array<{ field: string; label: string; previous: string | null; next: string | null }> {
  const changes: Array<{ field: string; label: string; previous: string | null; next: string | null }> = [];
  for (const { field, label } of TRACKED_FIELDS) {
    const before = previous[field];
    const after = next[field];
    if ((before ?? null) !== (after ?? null)) {
      changes.push({
        field,
        label,
        previous: typeof before === 'string' ? before : before == null ? null : String(before),
        next: typeof after === 'string' ? after : after == null ? null : String(after),
      });
    }
  }
  return changes;
}

/** Run async work over a list with at most `limit` in flight at once. */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

type ChangeList = Array<{ field: string; label: string; previous: string | null; next: string | null }>;

function taskRow(userId: string, event: ParsedEvent, hash: string) {
  return {
    user_id: userId,
    title: event.summary || 'ManageBac calendar entry',
    description: event.description,
    due_date: event.dueAt ? event.dueAt.slice(0, 10) : null,
    due_time: event.dueHasTime && event.dueAt ? event.dueAt.slice(11, 16) : null,
    // The feed carries no category or priority. Priority comes from title keywords
    // (Summative / Formative / Task 3); subject and estimated duration stay blank.
    category: 'other',
    priority: autoPriority(event.summary),
    status: 'not_started',
    external_source: 'managebac_calendar',
    external_uid: event.uid,
    external_hash: hash,
  };
}

function reminderRow(userId: string, event: ParsedEvent, taskId: string | null) {
  return {
    user_id: userId,
    task_id: taskId,
    title: event.summary || 'ManageBac calendar entry',
    message: 'Imported from ManageBac Calendar',
    reminder_type: 'task_due',
    scheduled_for: event.dueAt,
    repeat_rule: 'none',
    is_enabled: true,
    is_read: false,
    dedupe_key: `managebac:${event.uid}`,
  };
}

const isFuture = (iso: string | null) => Boolean(iso) && new Date(iso as string).getTime() > Date.now();

/**
 * Sync one student's connection. Returns counts, or throws with a safe category.
 *
 * Everything is batched: one read of what is already imported, one insert for all new
 * tasks, one for their calendar rows, one for reminders and one for the change inbox.
 * Only entries that changed in ManageBac are handled individually (a few at a time,
 * in parallel). The old one-entry-at-a-time version took ~30 s for a first sync.
 */
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

  // A feed can repeat a UID; the last copy wins, as it did before.
  const byUid = new Map<string, ParsedEvent>();
  for (const e of parseCalendar(text)) byUid.set(e.uid, e);
  const events = [...byUid.values()];
  const hashes = new Map<string, string>(
    await Promise.all(events.map(async (e) => [e.uid, await hashEvent(e)] as [string, string]))
  );

  const userId = connection.user_id;
  const result: SyncResult = { imported: 0, updated: 0, unchanged: 0, sparse: false, newChanges: 0 };
  const nowIso = new Date().toISOString();
  if (events.some((e) => !e.description)) result.sparse = true;

  // ---- 1. Everything already imported for this student, in one read.
  const existingByUid = new Map<string, Record<string, any>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('managebac_calendar_events')
      .select('id, external_uid, task_id, disposition, content_hash, summary, description, location, start_at, end_at, due_at')
      .eq('user_id', userId)
      .range(from, from + 999);
    if (error) throw new Error('UNAVAILABLE');
    for (const row of data ?? []) existingByUid.set(row.external_uid, row);
    if (!data || data.length < 1000) break;
  }

  const fresh = events.filter((e) => !existingByUid.has(e.uid));
  const changed = events.filter((e) => {
    const ex = existingByUid.get(e.uid);
    return ex && ex.content_hash !== hashes.get(e.uid);
  });
  result.unchanged = events.length - fresh.length - changed.length;

  // Existing reminders for every entry we might touch, in one read.
  const reminderByKey = new Map<string, { id: string; scheduled_for: string }>();
  const touchedKeys = [...fresh, ...changed].filter((e) => isFuture(e.dueAt)).map((e) => `managebac:${e.uid}`);
  for (let i = 0; i < touchedKeys.length; i += 200) {
    const { data } = await admin
      .from('reminders')
      .select('id, scheduled_for, dedupe_key')
      .eq('user_id', userId)
      .in('dedupe_key', touchedKeys.slice(i, i + 200));
    for (const r of data ?? []) reminderByKey.set(r.dedupe_key, { id: r.id, scheduled_for: r.scheduled_for });
  }

  const inbox: Array<Record<string, unknown>> = [];
  const newReminders: Array<Record<string, unknown>> = [];

  // ---- 2. New entries: tasks, calendar rows, reminders, all in bulk.
  if (fresh.length > 0) {
    const taskIdByUid = new Map<string, string>();
    const { data: createdTasks, error: taskErr } = await admin
      .from('tasks')
      .insert(fresh.map((e) => taskRow(userId, e, hashes.get(e.uid)!)))
      .select('id, external_uid');
    if (!taskErr) {
      for (const t of createdTasks ?? []) taskIdByUid.set(t.external_uid, t.id);
    } else {
      // One bad row (or a sync running at the same moment) fails the batch; fall back
      // to one at a time so every other entry still imports.
      await runPool(fresh, 8, async (e) => {
        const { data } = await admin
          .from('tasks')
          .insert(taskRow(userId, e, hashes.get(e.uid)!))
          .select('id')
          .maybeSingle();
        if (data?.id) taskIdByUid.set(e.uid, data.id);
      });
    }

    const { data: insertedEvents } = await admin
      .from('managebac_calendar_events')
      .upsert(
        fresh.map((e) => ({
          user_id: userId,
          connection_id: connection.id,
          external_uid: e.uid,
          summary: e.summary,
          description: e.description,
          location: e.location,
          start_at: e.startAt,
          end_at: e.endAt,
          due_at: e.dueAt,
          last_modified_at: e.lastModifiedAt,
          disposition: 'task',
          content_hash: hashes.get(e.uid),
          task_id: taskIdByUid.get(e.uid) ?? null,
          updated_at: nowIso,
        })),
        { onConflict: 'user_id,external_uid', ignoreDuplicates: true }
      )
      .select('external_uid');
    const insertedUids = new Set((insertedEvents ?? []).map((r: { external_uid: string }) => r.external_uid));

    for (const e of fresh) {
      // Skip entries another sync imported at the same moment.
      if (!insertedUids.has(e.uid)) continue;
      const taskId = taskIdByUid.get(e.uid) ?? null;
      if (isFuture(e.dueAt) && !reminderByKey.has(`managebac:${e.uid}`)) newReminders.push(reminderRow(userId, e, taskId));
      inbox.push({
        user_id: userId,
        connection_id: connection.id,
        external_uid: e.uid,
        task_id: taskId,
        change_kind: 'new',
        changes: [{ field: 'summary', label: 'Title', previous: null, next: e.summary }],
      });
      result.imported += 1;
    }
  }

  // ---- 3. Entries ManageBac changed: diff, refresh, and update untouched tasks.
  if (changed.length > 0) {
    const taskIds = changed.map((e) => existingByUid.get(e.uid)!.task_id).filter(Boolean);
    const taskHash = new Map<string, string | null>();
    for (let i = 0; i < taskIds.length; i += 200) {
      const { data } = await admin.from('tasks').select('id, external_hash').in('id', taskIds.slice(i, i + 200));
      for (const t of data ?? []) taskHash.set(t.id, t.external_hash);
    }

    await runPool(changed, 8, async (e) => {
      const existing = existingByUid.get(e.uid)!;
      const newHash = hashes.get(e.uid)!;
      const fieldChanges: ChangeList = diffEvents(existing, e);
      await admin
        .from('managebac_calendar_events')
        .update({
          summary: e.summary,
          description: e.description,
          location: e.location,
          start_at: e.startAt,
          end_at: e.endAt,
          due_at: e.dueAt,
          last_modified_at: e.lastModifiedAt,
          content_hash: newHash,
          updated_at: nowIso,
        })
        .eq('id', existing.id);

      // Only overwrite when the task still holds exactly what the last import wrote.
      // If the student has edited it, their version wins and is left untouched.
      if (existing.task_id && taskHash.has(existing.task_id) && taskHash.get(existing.task_id) === existing.content_hash) {
        await admin
          .from('tasks')
          .update({
            title: e.summary || 'ManageBac calendar entry',
            description: e.description,
            due_date: e.dueAt ? e.dueAt.slice(0, 10) : null,
            due_time: e.dueHasTime && e.dueAt ? e.dueAt.slice(11, 16) : null,
            external_hash: newHash,
            updated_at: nowIso,
          })
          .eq('id', existing.task_id);
        if (isFuture(e.dueAt)) {
          const rem = reminderByKey.get(`managebac:${e.uid}`);
          if (!rem) newReminders.push(reminderRow(userId, e, existing.task_id));
          else if (rem.scheduled_for !== e.dueAt) {
            await admin.from('reminders').update({ scheduled_for: e.dueAt, updated_at: nowIso }).eq('id', rem.id);
          }
        }
      }
      inbox.push({
        user_id: userId,
        connection_id: connection.id,
        external_uid: e.uid,
        task_id: existing.task_id,
        change_kind: 'edited',
        changes: fieldChanges,
      });
      result.updated += 1;
    });
  }

  // ---- 4. Reminders and the change inbox, in bulk. Failures never block the sync.
  if (newReminders.length > 0) {
    const { error } = await admin.from('reminders').insert(newReminders);
    if (error) {
      // A duplicate from a parallel sync fails the batch; insert the rest one by one.
      await runPool(newReminders, 8, async (r) => { await admin.from('reminders').insert(r); });
    }
  }
  if (inbox.length > 0) {
    const { error } = await admin.from('sync_change_inbox').insert(inbox);
    if (error) console.error('change-inbox insert failed:', error.code ?? 'unknown');
    else result.newChanges = inbox.length;
  }

  return result;
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

      await runPool<{ id: string; user_id: string; enc_feed_url: string }>(connections ?? [], 4, async (connection) => {
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
      });

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
        changesDetected: result.newChanges,
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
