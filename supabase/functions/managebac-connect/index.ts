import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * ManageBac calendar connection manager.
 *
 * The student pastes their ManageBac iCalendar subscription link into Settings. This
 * function is the ONLY place that ever sees the plaintext link:
 *  - it verifies the caller's TaskTrack token,
 *  - checks the link points at an official ManageBac host over HTTPS,
 *  - fetches it once to confirm it is a real calendar feed,
 *  - encrypts it with AES-GCM and stores only the ciphertext.
 *
 * The plaintext link is never returned to any browser and never logged. Disconnect,
 * delete and per-event disposition are handled here too, with the service role, so the
 * browser never needs write access to the connection row.
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

/** Official ManageBac calendar hosts. Anything else is refused outright. */
const ALLOWED_SUFFIXES = ['.managebac.com', '.managebac.cn'];

function extraAllowedHosts(): string[] {
  const raw = Deno.env.get('MANAGEBAC_FEED_HOSTS');
  if (!raw) return [];
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return extraAllowedHosts().some((h) => host === h || host.endsWith(`.${h}`));
}

/** True when MANAGEBAC_FEED_HOSTS is unset and the built-in allowlist is the only source. */
function hostRestrictionConfigured(): boolean {
  return ALLOWED_SUFFIXES.length > 0 || Deno.env.get('MANAGEBAC_FEED_HOSTS') !== undefined;
}

/** Never log a full feed URL — only its origin. */
function maskUrl(url: URL): string {
  return `${url.origin}/\u2026`;
}

/**
 * IPv4/IPv6 literal or a hostname that resolves (in Deno) must never point at a private
 * or internal destination. ManageBac hosts are public, so any private-range literal is
 * an SSRF attempt even if it somehow carries an allowed hostname via a redirect.
 */
function isPrivateAddress(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  // IPv6 literal (URL.hostname keeps brackets)
  const v6 = h.replace(/^\[|\]$/g, '');
  if (v6.includes(':')) {
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    return false;
  }
  // IPv4 literal, including decimal/hex/octal tricks
  const parts = h.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const octets = parts.map(Number);
    if (octets.some((o) => o > 255)) return true;
    const [a, b] = octets;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) ||
      a >= 224
    );
  }
  // Single-label or all-numeric host forms that bypass dotted-quad checks
  if (parts.length < 2 || /^\d+$/.test(h.replace(/\./g, ''))) return true;
  return false;
}

/**
 * A feed URL is only accepted if it is HTTPS, has no embedded credentials, and its host
 * is an official ManageBac host. This is the anti-SSRF guard: a student cannot point the
 * server at an internal address, because only ManageBac hostnames are allowed.
 */
function validateFeedUrl(raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: 'That does not look like a valid link. Paste the full calendar subscription link from ManageBac.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, message: 'The calendar link must start with https://. Please copy it again from ManageBac.' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'That link is not a ManageBac calendar subscription link.' };
  }

  const host = url.hostname.toLowerCase();
  if (isPrivateAddress(host)) {
    return { ok: false, message: 'This link is not from ManageBac. Please use the iCalendar subscription link from your ManageBac calendar.' };
  }
  const allowed =
    ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    extraAllowedHosts().some((h) => host === h || host.endsWith(`.${h}`));

  if (!allowed) {
    return {
      ok: false,
      message:
        'This link is not from ManageBac. Please use the iCalendar subscription link from your ManageBac calendar.',
    };
  }

  return { ok: true, url };
}

/**
 * Fetch the feed once to confirm it is a genuine calendar, with a timeout and a size
 * cap so a hostile or broken endpoint cannot hang or flood the function. Every redirect
 * hop is re-checked against the host allowlist and private-address rules, so an allowed
 * host cannot bounce the server to an internal address. The body is discarded either
 * way; only the origin is ever logged, never the path or token.
 */
async function confirmIsCalendar(url: URL): Promise<{ ok: boolean; message?: string; empty?: boolean }> {
  let current = url;
  for (let hop = 0; hop <= 3; hop += 1) {
    const host = current.hostname.toLowerCase();
    if (isPrivateAddress(host)) return { ok: false, message: 'This link is not from ManageBac. Please use the iCalendar subscription link from your ManageBac calendar.' };
    if (!hostAllowed(current.hostname)) return { ok: false, message: 'This link is not from ManageBac. Please use the iCalendar subscription link from your ManageBac calendar.' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        headers: { Accept: 'text/calendar, text/plain, */*' },
        signal: controller.signal,
      });
    } catch {
      return { ok: false, message: 'The ManageBac calendar could not be reached. Check that your subscription link is still active.' };
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, message: 'The ManageBac calendar could not be reached. Check that your subscription link is still active.' };
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, message: 'The ManageBac calendar could not be reached. Check that your subscription link is still active.' };
      }
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: 'That subscription link is not authorised. Copy a fresh link from ManageBac and try again.' };
    }
    if (res.status === 404 || res.status === 410) {
      return { ok: false, message: 'That subscription link is no longer active. Create a new one in ManageBac and try again.' };
    }
    if (res.status === 429) {
      return { ok: false, message: 'ManageBac is rate limiting requests. Wait a moment and try again.' };
    }
    if (!res.ok) {
      return { ok: false, message: 'The ManageBac calendar could not be reached. Check that your subscription link is still active.' };
    }

    const text = (await res.text()).slice(0, 2_000_000);
    // Content check is on the body, never on the extension or Content-Type: a login or
    // error page must not pass.
    if (!text.includes('BEGIN:VCALENDAR')) {
      return { ok: false, message: 'This link does not look like a calendar subscription. Make sure you copied the iCalendar subscription link, not a ManageBac page address.' };
    }
    if (!text.includes('BEGIN:VEVENT')) {
      return { ok: false, empty: true };
    }
    return { ok: true };
  }
  return { ok: false, message: 'The ManageBac calendar could not be reached. Check that your subscription link is still active.' };
}

// ---- AES-GCM encryption of the feed URL ----

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function importKey(encKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(encKeyB64), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptUrl(encKeyB64: string, plaintext: string): Promise<string> {
  const key = await importKey(encKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return bytesToB64(combined);
}

/**
 * Normalize a pasted feed link on the server: trim, convert a leading webcal:// to
 * https:// (case-insensitive), preserve everything else exactly, and reject any other
 * protocol. Applied to both verify and connect so the browser's conversion is never
 * the only line of defence.
 */
function normalizeFeedProtocol(
  raw: string
): { ok: true; url: string; converted: boolean } | { ok: false; message: string } {
  const trimmed = raw.trim();
  const webcalMatch = /^webcal:\/\//i.exec(trimmed);
  const candidate = webcalMatch ? `https://${trimmed.slice(webcalMatch[0].length)}` : trimmed;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(candidate);
  if (schemeMatch && schemeMatch[1].toLowerCase() !== 'https') {
    return {
      ok: false,
      message: 'That link starts with an unsupported format. Please paste the webcal:// or https:// subscription link from ManageBac.',
    };
  }
  return { ok: true, url: candidate, converted: Boolean(webcalMatch) };
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
      return json({ ok: false, error: 'ManageBac connection is unavailable right now.' }, 503);
    }

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
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : 'connect';

    // ---- Disconnect: forget the link, stop future syncs, keep imported items ----
    if (action === 'disconnect' || action === 'delete') {
      const { data: connection } = await admin
        .from('managebac_calendar_connections')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (connection) {
        await admin.from('managebac_calendar_connections').delete().eq('user_id', userId);
      }

      if (action === 'delete') {
        // Also clear the import bookkeeping. Imported tasks are left alone: they may
        // have been edited and worked on, and TaskTrack never deletes a task for the
        // student without them doing it.
        await admin.from('managebac_calendar_events').delete().eq('user_id', userId);
      }

      return json({ ok: true, action });
    }

    // ---- Per-event disposition ----
    if (action === 'disposition') {
      const uid = typeof body?.uid === 'string' ? body.uid : '';
      const disposition = typeof body?.disposition === 'string' ? body.disposition : '';
      if (!uid || !['task', 'event', 'ignored'].includes(disposition)) {
        return json({ ok: false, error: 'That change could not be applied.' }, 400);
      }

      const { data: event } = await admin
        .from('managebac_calendar_events')
        .select('id, task_id, summary, description, location, due_at, start_at')
        .eq('user_id', userId)
        .eq('external_uid', uid)
        .maybeSingle();

      if (!event) {
        return json({ ok: false, error: 'That calendar entry could not be found.' }, 404);
      }

      let taskId: string | null = event.task_id ?? null;

      if (disposition === 'task' && !taskId) {
        const { data: created } = await admin
          .from('tasks')
          .insert({
            user_id: userId,
            title: event.summary || 'ManageBac calendar entry',
            description: event.description ?? null,
            due_date: (event.due_at ?? event.start_at)?.slice(0, 10) ?? null,
            category: 'other',
            priority: 'medium',
            status: 'not_started',
            external_source: 'managebac_calendar',
            external_uid: uid,
            external_hash: null,
          })
          .select('id')
          .maybeSingle();
        taskId = created?.id ?? null;

        if (taskId) {
          await admin
            .from('managebac_calendar_events')
            .update({ task_id: taskId, disposition: 'task', updated_at: new Date().toISOString() })
            .eq('id', event.id);
        }
      } else if (disposition !== 'task' && taskId) {
        // Only an untouched import is removed. A task the student has since edited or
        // completed is left in place, so no work is ever lost.
        const { data: task } = await admin
          .from('tasks')
          .select('id, external_hash')
          .eq('id', taskId)
          .maybeSingle();
        if (task?.external_hash === null) {
          await admin.from('tasks').delete().eq('id', taskId);
          taskId = null;
        }
        await admin
          .from('managebac_calendar_events')
          .update({ task_id: taskId, disposition, updated_at: new Date().toISOString() })
          .eq('id', event.id);
      } else {
        await admin
          .from('managebac_calendar_events')
          .update({ disposition, updated_at: new Date().toISOString() })
          .eq('id', event.id);
      }

      return json({ ok: true, disposition });
    }

    // ---- Verify: check the link without saving anything ----
    if (action === 'verify') {
      if (!hostRestrictionConfigured()) {
        // Missing server configuration is a setup problem, not the student's link being
        // wrong, and the host restriction is never skipped because of it.
        return json({ ok: false, error: 'Calendar verification is not configured correctly on our side. Please try again later.' }, 503);
      }

      // Per-user rate limit, stored in the database so it holds across instances. If
      // the log table is missing (setup problem), fail closed with a setup error
      // rather than skipping the limit.
      const windowStart = new Date(Date.now() - 60_000).toISOString();
      const { count, error: limitError } = await admin
        .from('managebac_verify_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', windowStart);
      if (limitError) {
        return json({ ok: false, error: 'Calendar verification is not configured correctly on our side. Please try again later.' }, 503);
      }
      if ((count ?? 0) >= 5) {
        return json({ ok: false, error: 'Too many verification attempts. Please wait a minute and try again.' }, 429);
      }
      const { error: logError } = await admin.from('managebac_verify_log').insert({ user_id: userId });
      if (logError) {
        return json({ ok: false, error: 'Calendar verification is not configured correctly on our side. Please try again later.' }, 503);
      }

      const raw = typeof body?.feedUrl === 'string' ? body.feedUrl.trim() : '';
      if (!raw) {
        return json({ ok: false, error: 'Paste your ManageBac calendar subscription link first.' }, 400);
      }
      if (raw.length > 4000) {
        return json({ ok: false, error: 'That link is too long. Copy the subscription link again from ManageBac.' }, 400);
      }

      const normalized = normalizeFeedProtocol(raw);
      if (!normalized.ok) {
        return json({ ok: false, error: normalized.message }, 400);
      }
      const parsed = new URL(normalized.url);
      if (!hostAllowed(parsed.hostname)) {
        return json({ ok: false, error: 'This link is not from ManageBac. Please use the iCalendar subscription link from your ManageBac calendar.' }, 400);
      }

      const reachable = await confirmIsCalendar(parsed);
      if (!reachable.ok) {
        return json({ ok: false, error: reachable.message ?? 'The calendar could not be verified. Please try again.' }, 400);
      }
      return json({ ok: true, empty: reachable.empty === true });
    }

    // ---- Connect ----
    const feedUrl = typeof body?.feedUrl === 'string' ? body.feedUrl.trim() : '';
    if (!feedUrl) {
      return json({ ok: false, error: 'Paste your ManageBac calendar subscription link first.' }, 400);
    }
    if (feedUrl.length > 4000) {
      return json({ ok: false, error: 'That link is too long. Copy the subscription link again from ManageBac.' }, 400);
    }

    const normalizedConnect = normalizeFeedProtocol(feedUrl);
    if (!normalizedConnect.ok) {
      return json({ ok: false, error: normalizedConnect.message }, 400);
    }

    const validation = validateFeedUrl(normalizedConnect.url);
    if (!validation.ok) {
      return json({ ok: false, error: validation.message }, 400);
    }

    const reachable = await confirmIsCalendar(validation.url);
    if (!reachable.ok) {
      return json({ ok: false, error: reachable.message }, 400);
    }

    const { data: secrets } = await admin
      .from('integration_secrets')
      .select('enc_key')
      .eq('id', 1)
      .maybeSingle();
    if (!secrets?.enc_key) {
      return json({ ok: false, error: 'The connection cannot be completed securely right now.' }, 503);
    }

    const encFeedUrl = await encryptUrl(secrets.enc_key, validation.url.toString());

    const { error: saveError } = await admin
      .from('managebac_calendar_connections')
      .upsert(
        {
          user_id: userId,
          enc_feed_url: encFeedUrl,
          last_sync_status: null,
          last_sync_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (saveError) {
      return json({ ok: false, error: 'Your ManageBac calendar could not be saved. Please try again.' }, 500);
    }

    return json({ ok: true, connected: true });
  } catch (err) {
    console.error('ManageBac connect failed:', err instanceof Error ? err.message : 'unknown');
    return json({ ok: false, error: 'Something went wrong connecting your ManageBac calendar. Please try again.' }, 500);
  }
});
