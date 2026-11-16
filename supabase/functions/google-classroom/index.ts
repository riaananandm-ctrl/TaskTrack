import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Google Classroom import for TaskTrack.
 *
 * Actions
 *  - POST {action:"start"}      (signed-in student) -> { url } of Google's consent screen.
 *  - GET  ?code&state           Google's redirect back here. Exchanges the code, stores the
 *                               refresh token encrypted, runs a first sync, then sends the
 *                               student back to Settings > Integrations.
 *  - POST {action:"sync"}       (signed-in student) sync their own classes now.
 *  - POST {action:"disconnect"} (signed-in student) revoke Google access and forget it.
 *  - POST {action:"scheduled"}  (cron, x-sync-secret) sync every connected student.
 *
 * Access is read-only: classes and the student's own coursework. Assignments with a due
 * date become tasks (external_source 'google_classroom'). A later sync only changes the
 * title or due date if the student has not edited them, never re-creates a task the
 * student deleted, and marks a task done once it is turned in on Classroom.
 *
 * Secrets (Edge Function secrets): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. The refresh
 * token is AES-GCM encrypted with integration_secrets.enc_key and is never returned to a
 * browser or logged.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const APP_URL = (Deno.env.get('APP_URL') || 'https://tasktrackbm.vercel.app').replace(/\/+$/, '');
const SETTINGS_URL = `${APP_URL}/app/settings?tab=integrations`;
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
];
const STATE_TTL_MS = 10 * 60 * 1000;
// Only recent and upcoming work is imported, so connecting does not flood the task list.
const PAST_DAYS = 7;
const MAX_COURSES = 30;
const MAX_WORK_PER_COURSE = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function redirect(result: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${SETTINGS_URL}&classroom=${result}` } });
}

type Admin = ReturnType<typeof createClient>;

// ---- Encryption (same scheme as the ManageBac feed link) ----

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
async function aesKey(encKeyB64: string, usage: 'encrypt' | 'decrypt') {
  return crypto.subtle.importKey('raw', b64ToBytes(encKeyB64), { name: 'AES-GCM' }, false, [usage]);
}
async function encrypt(encKeyB64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(encKeyB64, 'encrypt'), new TextEncoder().encode(plain))
  );
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return bytesToB64(combined);
}
async function decrypt(encKeyB64: string, combinedB64: string): Promise<string> {
  const combined = b64ToBytes(combinedB64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) },
    await aesKey(encKeyB64, 'decrypt'),
    combined.slice(12)
  );
  return new TextDecoder().decode(plain);
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Google ----

class GoogleError extends Error {
  constructor(public code: 'RECONNECT' | 'FORBIDDEN' | 'UNAVAILABLE') {
    super(code);
  }
}

function googleCreds(): { id: string; secret: string } | null {
  const id = Deno.env.get('GOOGLE_CLIENT_ID');
  const secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  return id && secret ? { id, secret } : null;
}

function callbackUrl(): string {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-classroom`;
}

async function accessTokenFor(refreshToken: string): Promise<string> {
  const creds = googleCreds();
  if (!creds) throw new GoogleError('UNAVAILABLE');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.id,
      client_secret: creds.secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.access_token !== 'string') {
    // invalid_grant: the student revoked access, or the school blocked the app.
    if (data?.error === 'invalid_grant' || res.status === 400 || res.status === 401) throw new GoogleError('RECONNECT');
    throw new GoogleError('UNAVAILABLE');
  }
  return data.access_token;
}

async function classroomGet(token: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://classroom.googleapis.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new GoogleError('RECONNECT');
  if (res.status === 403) throw new GoogleError('FORBIDDEN');
  if (!res.ok) throw new GoogleError('UNAVAILABLE');
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const SAFE_MESSAGES: Record<string, string> = {
  RECONNECT: 'Google access was removed or expired. Connect Google Classroom again.',
  FORBIDDEN: 'Your school blocked TaskTrack from reading Classroom. Ask your school IT admin to allow TaskTrack.',
  UNAVAILABLE: 'Google Classroom could not be reached. TaskTrack will try again soon.',
};
function safeMessage(err: unknown): string {
  return SAFE_MESSAGES[err instanceof GoogleError ? err.code : 'UNAVAILABLE'];
}

// ---- Sync ----

interface Course { id: string; name: string; section?: string }
interface CourseWork {
  id: string;
  title?: string;
  description?: string;
  alternateLink?: string;
  workType?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
}

function autoPriority(title: string): 'urgent' | 'high' | 'medium' {
  if (/\bsummative\b/i.test(title)) return 'urgent';
  if (/\bformative\b|\b(test|exam|quiz)\b/i.test(title)) return 'high';
  return 'medium';
}

function validTimeZone(tz: string | null | undefined): string {
  if (tz) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      return tz;
    } catch {
      // fall through
    }
  }
  return 'Asia/Kolkata';
}

/** Classroom due dates are UTC. Convert to the student's own date and time. */
function localDue(work: CourseWork, tz: string): { date: string; time: string | null } | null {
  if (!work.dueDate?.year || !work.dueDate.month || !work.dueDate.day) return null;
  const hasTime = work.dueTime && (work.dueTime.hours !== undefined || work.dueTime.minutes !== undefined);
  const utc = new Date(Date.UTC(
    work.dueDate.year, work.dueDate.month - 1, work.dueDate.day,
    hasTime ? work.dueTime?.hours ?? 0 : 23, hasTime ? work.dueTime?.minutes ?? 0 : 59
  ));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(utc).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: hasTime ? `${parts.hour}:${parts.minute}` : null };
}

function matchSubject(courseName: string, subjects: { id: string; name: string }[]): string | null {
  const course = courseName.toLowerCase();
  const hits = subjects.filter((s) => {
    const name = s.name.trim().toLowerCase();
    return name.length >= 3 && (course.includes(name) || name.includes(course));
  });
  return hits.length === 1 ? hits[0].id : null;
}

interface SyncResult { imported: number; updated: number; completed: number }

async function syncStudent(
  admin: Admin,
  connection: { id: string; user_id: string; enc_refresh_token: string },
  encKey: string
): Promise<SyncResult> {
  const token = await accessTokenFor(await decrypt(encKey, connection.enc_refresh_token));
  const userId = connection.user_id;

  const [{ data: profile }, { data: subjects }] = await Promise.all([
    admin.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
    admin.from('subjects').select('id, name').eq('user_id', userId).eq('is_archived', false),
  ]);
  const tz = validTimeZone(profile?.timezone);
  const subjectList = (subjects ?? []) as { id: string; name: string }[];

  const coursesRes = await classroomGet(token, `courses?studentId=me&courseStates=ACTIVE&pageSize=${MAX_COURSES}`);
  const courses = ((coursesRes.courses as Course[]) ?? []).slice(0, MAX_COURSES);

  const cutoff = new Date(Date.now() - PAST_DAYS * 86_400_000).toISOString().slice(0, 10);
  const result: SyncResult = { imported: 0, updated: 0, completed: 0 };
  const now = new Date().toISOString();

  for (const course of courses) {
    let work: CourseWork[] = [];
    try {
      const res = await classroomGet(
        token,
        `courses/${encodeURIComponent(course.id)}/courseWork?courseWorkStates=PUBLISHED&orderBy=dueDate%20desc&pageSize=${MAX_WORK_PER_COURSE}`
      );
      work = (res.courseWork as CourseWork[]) ?? [];
    } catch (err) {
      if (err instanceof GoogleError && err.code === 'RECONNECT') throw err;
      continue; // One class failing (e.g. archived mid-sync) must not stop the rest.
    }

    // Which of these the student has already turned in.
    const turnedIn = new Set<string>();
    try {
      const subs = await classroomGet(
        token,
        `courses/${encodeURIComponent(course.id)}/courseWork/-/studentSubmissions?userId=me&states=TURNED_IN&states=RETURNED&pageSize=100`
      );
      for (const s of (subs.studentSubmissions as { courseWorkId?: string }[]) ?? []) {
        if (s.courseWorkId) turnedIn.add(s.courseWorkId);
      }
    } catch {
      // Not fatal: completion just is not synced this time.
    }

    const courseName = [course.name, course.section].filter(Boolean).join(' ');
    const subjectId = matchSubject(course.name || '', subjectList);

    for (const item of work) {
      const due = localDue(item, tz);
      if (!due || due.date < cutoff) continue;

      const title = (item.title || 'Classroom assignment').trim().slice(0, 300);
      const details = (item.description || '').trim().slice(0, 2000);
      const description = [
        `Google Classroom: ${courseName}`,
        details,
        item.alternateLink ? `Open in Classroom: ${item.alternateLink}` : '',
      ].filter(Boolean).join('\n\n');
      const hash = await sha256(JSON.stringify([title, description, due.date, due.time]));
      const isTurnedIn = turnedIn.has(item.id);

      const { data: existing } = await admin
        .from('google_classroom_items')
        .select('id, task_id, content_hash, imported_title, imported_due_date, imported_due_time, turned_in')
        .eq('user_id', userId)
        .eq('course_id', course.id)
        .eq('course_work_id', item.id)
        .maybeSingle();

      if (!existing) {
        const uid = `${course.id}:${item.id}`;
        // After a disconnect and reconnect the task may already exist: link it, don't copy it.
        const { data: already } = await admin
          .from('tasks')
          .select('id')
          .eq('user_id', userId)
          .eq('external_source', 'google_classroom')
          .eq('external_uid', uid)
          .maybeSingle();
        const { data: task } = already ? { data: already } : await admin
          .from('tasks')
          .insert({
            user_id: userId,
            title,
            description,
            due_date: due.date,
            due_time: due.time,
            subject_id: subjectId,
            category: 'homework',
            priority: autoPriority(title),
            status: isTurnedIn ? 'completed' : 'not_started',
            external_source: 'google_classroom',
            external_uid: uid,
            external_hash: hash,
          })
          .select('id')
          .maybeSingle();
        await admin.from('google_classroom_items').insert({
          user_id: userId,
          course_id: course.id,
          course_work_id: item.id,
          course_name: courseName,
          task_id: task?.id ?? null,
          imported_title: title,
          imported_due_date: due.date,
          imported_due_time: due.time,
          content_hash: hash,
          turned_in: isTurnedIn,
          updated_at: now,
        });
        if (task?.id && !already) result.imported += 1;
        continue;
      }

      // The student deleted the task: respect that and never bring it back.
      if (!existing.task_id) continue;

      const patch: Record<string, unknown> = {};
      if (existing.content_hash !== hash) {
        const { data: current } = await admin
          .from('tasks')
          .select('title, due_date, due_time')
          .eq('id', existing.task_id)
          .maybeSingle();
        if (current) {
          // Only change what still matches the last import; the student's edits win.
          if (current.title === existing.imported_title && title !== existing.imported_title) patch.title = title;
          const currentTime = current.due_time ? String(current.due_time).slice(0, 5) : null;
          const sameDue = current.due_date === existing.imported_due_date && currentTime === (existing.imported_due_time ?? null);
          if (sameDue && (due.date !== existing.imported_due_date || due.time !== (existing.imported_due_time ?? null))) {
            patch.due_date = due.date;
            patch.due_time = due.time;
          }
        }
      }
      if (isTurnedIn && !existing.turned_in) {
        patch.status = 'completed';
        result.completed += 1;
      }
      if (Object.keys(patch).length > 0) {
        await admin.from('tasks').update({ ...patch, updated_at: now }).eq('id', existing.task_id);
        if (patch.title || patch.due_date) result.updated += 1;
      }
      if (existing.content_hash !== hash || isTurnedIn !== existing.turned_in) {
        await admin.from('google_classroom_items').update({
          course_name: courseName,
          imported_title: title,
          imported_due_date: due.date,
          imported_due_time: due.time,
          content_hash: hash,
          turned_in: isTurnedIn,
          updated_at: now,
        }).eq('id', existing.id);
      }
    }
  }
  return result;
}

async function recordSync(admin: Admin, connectionId: string, outcome: { ok: true; result: SyncResult } | { ok: false; err: unknown }) {
  const now = new Date().toISOString();
  if (outcome.ok) {
    await admin.from('google_classroom_connections').update({
      status: 'active',
      last_sync_at: now,
      last_sync_status: 'success',
      last_sync_error: null,
      last_sync_imported: outcome.result.imported + outcome.result.updated,
      updated_at: now,
    }).eq('id', connectionId);
  } else {
    const reconnect = outcome.err instanceof GoogleError && outcome.err.code === 'RECONNECT';
    await admin.from('google_classroom_connections').update({
      ...(reconnect ? { status: 'reconnect' } : {}),
      last_sync_at: now,
      last_sync_status: 'error',
      last_sync_error: safeMessage(outcome.err),
      updated_at: now,
    }).eq('id', connectionId);
  }
}

// ---- Handlers ----

async function handleCallback(admin: Admin, encKey: string, url: URL): Promise<Response> {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code');
  const googleError = url.searchParams.get('error');

  const { data: pending } = state
    ? await admin.from('google_classroom_oauth_states').select('user_id, created_at').eq('state', state).maybeSingle()
    : { data: null };
  if (state) await admin.from('google_classroom_oauth_states').delete().eq('state', state);

  if (googleError) return redirect(googleError === 'access_denied' ? 'cancelled' : 'blocked');
  if (!pending || !code || Date.now() - new Date(pending.created_at).getTime() > STATE_TTL_MS) return redirect('expired');

  const creds = googleCreds();
  if (!creds) return redirect('unavailable');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.id,
      client_secret: creds.secret,
      redirect_uri: callbackUrl(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || typeof tokens.access_token !== 'string') {
    console.error('Classroom token exchange failed with status', res.status);
    return redirect('failed');
  }
  const granted = String(tokens.scope || '');
  if (!granted.includes('classroom.coursework.me.readonly') || !granted.includes('classroom.courses.readonly')) {
    return redirect('scopes');
  }

  // Which Google account it is, so Settings can show it.
  let googleEmail: string | null = null;
  try {
    const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => r.json());
    if (typeof info.email === 'string') googleEmail = info.email;
  } catch {
    // optional
  }

  const { data: existing } = await admin
    .from('google_classroom_connections')
    .select('id, enc_refresh_token')
    .eq('user_id', pending.user_id)
    .maybeSingle();

  // Google only sends a refresh token the first time; keep the old one otherwise.
  const encRefresh = typeof tokens.refresh_token === 'string'
    ? await encrypt(encKey, tokens.refresh_token)
    : existing?.enc_refresh_token;
  if (!encRefresh) return redirect('failed');

  const now = new Date().toISOString();
  const { data: connection } = await admin
    .from('google_classroom_connections')
    .upsert({
      user_id: pending.user_id,
      google_email: googleEmail,
      enc_refresh_token: encRefresh,
      status: 'active',
      last_sync_error: null,
      updated_at: now,
    }, { onConflict: 'user_id' })
    .select('id, user_id, enc_refresh_token')
    .maybeSingle();
  if (!connection) return redirect('failed');

  try {
    const result = await syncStudent(admin, connection, encKey);
    await recordSync(admin, connection.id, { ok: true, result });
  } catch (err) {
    await recordSync(admin, connection.id, { ok: false, err });
  }
  return redirect('connected');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ ok: false, error: 'Google Classroom is unavailable right now.' }, 503);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: secrets } = await admin
      .from('integration_secrets')
      .select('enc_key, sync_cron_secret')
      .eq('id', 1)
      .maybeSingle();
    if (!secrets?.enc_key) return json({ ok: false, error: 'Google Classroom is unavailable right now.' }, 503);

    // Google's redirect back after the student approves (or cancels).
    if (req.method === 'GET') return await handleCallback(admin, secrets.enc_key, new URL(req.url));
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

    const body = await req.json().catch(() => ({}));

    if (body?.action === 'scheduled') {
      if (req.headers.get('x-sync-secret') !== secrets.sync_cron_secret) return json({ ok: false, error: 'Not authorised.' }, 401);
      const { data: connections } = await admin
        .from('google_classroom_connections')
        .select('id, user_id, enc_refresh_token')
        .eq('status', 'active')
        .order('last_sync_at', { ascending: true, nullsFirst: true })
        .limit(40);
      let synced = 0;
      let failed = 0;
      for (const connection of connections ?? []) {
        try {
          const result = await syncStudent(admin, connection, secrets.enc_key);
          await recordSync(admin, connection.id, { ok: true, result });
          synced += 1;
        } catch (err) {
          await recordSync(admin, connection.id, { ok: false, err });
          failed += 1;
        }
      }
      // Old unfinished sign-ins are cleared out.
      await admin.from('google_classroom_oauth_states').delete().lt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString());
      return json({ ok: true, synced, failed });
    }

    // Everything else is for the signed-in student only.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    const userId = userData.user.id;

    if (body?.action === 'start') {
      const creds = googleCreds();
      if (!creds) return json({ ok: false, error: 'Google Classroom is not set up on TaskTrack yet.' }, 503);
      const state = randomState();
      await admin.from('google_classroom_oauth_states').insert({ state, user_id: userId });
      const params = new URLSearchParams({
        client_id: creds.id,
        redirect_uri: callbackUrl(),
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      if (userData.user.email) params.set('login_hint', userData.user.email);
      return json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }

    const { data: connection } = await admin
      .from('google_classroom_connections')
      .select('id, user_id, enc_refresh_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (body?.action === 'sync') {
      if (!connection) return json({ ok: false, error: 'Connect Google Classroom first.' }, 400);
      try {
        const result = await syncStudent(admin, connection, secrets.enc_key);
        await recordSync(admin, connection.id, { ok: true, result });
        return json({ ok: true, ...result });
      } catch (err) {
        await recordSync(admin, connection.id, { ok: false, err });
        return json({ ok: false, error: safeMessage(err) }, 400);
      }
    }

    if (body?.action === 'disconnect') {
      if (connection) {
        try {
          const refresh = await decrypt(secrets.enc_key, connection.enc_refresh_token);
          await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refresh }),
            signal: AbortSignal.timeout(10_000),
          });
        } catch {
          // Revoking is best effort; the token is deleted either way.
        }
        await admin.from('google_classroom_items').delete().eq('user_id', userId);
        await admin.from('google_classroom_connections').delete().eq('id', connection.id);
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('google-classroom failed:', err instanceof Error ? err.message : 'unknown');
    return json({ ok: false, error: 'Something went wrong with Google Classroom. Please try again.' }, 500);
  }
});
