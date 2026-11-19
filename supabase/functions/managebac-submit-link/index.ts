import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * "I'm done" -> "Great! Submit here: <link>".
 *
 * The study chat calls this when a student says they've finished a task. If the task
 * is a ManageBac task that's handed in online (not a test or in-class assessment),
 * it returns a short cheer plus a link to the student's ManageBac Tasks & Deadlines
 * page, where they submit it. Otherwise it returns { ok: true, text: null } and the
 * chat carries on as normal. It never calls the AI, so it costs no credits.
 *
 * ManageBac's calendar feed has no class id, and a task's own page needs one, so the
 * link goes to the school's Tasks & Deadlines page. The school address comes from the
 * saved (encrypted) calendar link; only the host is kept, never the private link.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Kept in step with lib/managebac-submit.ts.
const SUBMIT_WORDS = /\b(submit|submission|upload|hand(ed)? in|turn(ed)? in|add the (image|document|file|work))/i;
const IN_CLASS_WORDS = /\b(test|quiz|exam|examination|will be conducted|in class|oral|viva|presentation day)\b/i;
const IN_CLASS_CATEGORIES = new Set(['quiz', 'test', 'final_exam', 'mock_exam', 'presentation']);

function isSubmissionTask(task: {
  external_source?: string | null;
  external_uid?: string | null;
  title?: string | null;
  description?: string | null;
  category?: string | null;
}): boolean {
  if (task.external_source !== 'managebac_calendar' || !task.external_uid) return false;
  if (task.category && IN_CLASS_CATEGORIES.has(task.category)) return false;
  const text = `${task.title ?? ''} ${task.description ?? ''}`;
  if (SUBMIT_WORDS.test(text)) return true;
  return !IN_CLASS_WORDS.test(text);
}

async function decryptFeedUrl(encKeyB64: string, combinedB64: string): Promise<string> {
  const toBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', toBytes(encKeyB64), { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = toBytes(combinedB64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12));
  return new TextDecoder().decode(plain);
}

const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.managebac\.(com|cn)$/;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!authHeader || !url || !anon || !service) return json({ ok: false, error: 'Please sign in.' }, 401);

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ ok: false, error: 'Please sign in.' }, 401);

    let body: { taskId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'Invalid request.' }, 400);
    }
    if (typeof body.taskId !== 'string' || !body.taskId) return json({ ok: true, text: null });

    // Read as the student, so only their own task is visible.
    const { data: task } = await supabase
      .from('tasks')
      .select('id, title, description, category, external_source, external_uid')
      .eq('id', body.taskId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!task || !isSubmissionTask(task)) return json({ ok: true, text: null });

    // Already handed in: the sync saw it leave ManageBac and ticked it off.
    const { data: ev } = await supabase
      .from('managebac_calendar_events')
      .select('left_feed_at')
      .eq('task_id', task.id)
      .limit(1)
      .maybeSingle();
    if (ev?.left_feed_at) {
      return json({
        ok: true,
        text: `Great work! 🎉 ManageBac already shows **${task.title}** as handed in, so it's ticked off here too.`,
      });
    }

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: conn } = await admin
      .from('managebac_calendar_connections')
      .select('id, school_host, enc_feed_url')
      .eq('user_id', userId)
      .maybeSingle();
    if (!conn) return json({ ok: true, text: null });

    let host: string | null = conn.school_host && HOST_PATTERN.test(conn.school_host) ? conn.school_host : null;
    if (!host && conn.enc_feed_url) {
      const { data: secrets } = await admin.from('integration_secrets').select('enc_key').eq('id', 1).maybeSingle();
      if (secrets?.enc_key) {
        try {
          const h = new URL(await decryptFeedUrl(secrets.enc_key, conn.enc_feed_url)).hostname.toLowerCase();
          if (HOST_PATTERN.test(h)) {
            host = h;
            await admin.from('managebac_calendar_connections').update({ school_host: h }).eq('id', conn.id);
          }
        } catch {
          host = null;
        }
      }
    }
    if (!host) return json({ ok: true, text: null });

    const link = `https://${host}/student/tasks_and_deadlines`;
    const label = String(task.title ?? 'this task').replace(/[\[\]*`]/g, '').trim() || 'this task';
    return json({
      ok: true,
      text:
        `Great! 🎉 Submit here: [Hand in “${label}” on ManageBac](${link})\n\n` +
        `Once you've handed it in, TaskTrack ticks it off for you within a few minutes.`,
    });
  } catch (err) {
    console.error('Submit link failed:', err instanceof Error ? err.message : 'unknown');
    return json({ ok: true, text: null });
  }
});
