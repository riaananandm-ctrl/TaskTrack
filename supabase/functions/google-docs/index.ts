import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Live Google Doc for a study session.
 *
 * A student links a study session to a Google Doc. As they keep chatting with the study
 * AI, TaskTrack rewrites the doc so it always holds tidy, up-to-date notes from the
 * conversation, keeping anything the student typed into the doc themselves.
 *
 * Actions
 *  - POST {action:"status", sessionId?}  connected?, which account, and this session's doc.
 *  - POST {action:"start", returnTo}     -> { url } of Google's consent screen.
 *  - GET  ?code&state                    Google's redirect back; stores the refresh token.
 *  - POST {action:"create", sessionId}   make the doc for this session (and fill it).
 *  - POST {action:"update", sessionId}   rewrite the doc from the latest chat (1 credit).
 *  - POST {action:"unlink", sessionId}   stop updating; the doc stays in their Drive.
 *  - POST {action:"disconnect"}          revoke Google access and forget it.
 *
 * Access uses Google's "drive.file" scope: TaskTrack can only see and edit the docs it
 * created. The refresh token is AES-GCM encrypted and never leaves this function.
 *
 * Academic honesty: the doc is study notes. For graded writing it holds outlines,
 * evidence and feedback in the student's own words, never a ready-to-submit draft.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const APP_URL = (Deno.env.get('APP_URL') || 'https://tasktrackbm.vercel.app').replace(/\/+$/, '');
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_DOC_CHARS = 20_000;
const UPDATE_COST = 1;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type Admin = ReturnType<typeof createClient>;

// ---- Encryption (same scheme as the other Google and ManageBac links) ----

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

// ---- Google ----

class GoogleError extends Error {
  constructor(public code: 'RECONNECT' | 'MISSING_DOC' | 'UNAVAILABLE' | 'NOT_ENABLED') {
    super(code);
  }
}

const SAFE_MESSAGES: Record<string, string> = {
  RECONNECT: 'Google access was removed or expired. Connect Google Docs again.',
  MISSING_DOC: 'That Google Doc was deleted or moved to the bin. Create a new live doc.',
  UNAVAILABLE: 'Google Docs could not be reached. Please try again in a moment.',
  NOT_ENABLED: 'Google Docs is not switched on for TaskTrack yet. Please try again later.',
};
function safeMessage(err: unknown): string {
  return SAFE_MESSAGES[err instanceof GoogleError ? err.code : 'UNAVAILABLE'];
}

function googleCreds(): { id: string; secret: string } | null {
  const id = Deno.env.get('GOOGLE_CLIENT_ID');
  const secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  return id && secret ? { id, secret } : null;
}

function callbackUrl(): string {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-docs`;
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
    if (data?.error === 'invalid_grant' || res.status === 400 || res.status === 401) throw new GoogleError('RECONNECT');
    throw new GoogleError('UNAVAILABLE');
  }
  return data.access_token;
}

async function checkDrive(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  console.error('Drive request failed with status', res.status, text.slice(0, 300));
  if (res.status === 401) throw new GoogleError('RECONNECT');
  if (res.status === 404) throw new GoogleError('MISSING_DOC');
  if (res.status === 403 && /accessNotConfigured|has not been used|is disabled/i.test(text)) throw new GoogleError('NOT_ENABLED');
  throw new GoogleError('UNAVAILABLE');
}

/** Create a Google Doc from HTML (Drive converts it to a real, editable doc). */
async function createDoc(token: string, title: string, html: string): Promise<{ id: string; url: string }> {
  const boundary = `tasktrack${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document' });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  await checkDrive(res);
  const data = await res.json();
  return { id: data.id, url: data.webViewLink || `https://docs.google.com/document/d/${data.id}/edit` };
}

/** Replace the doc's content with new HTML. */
async function replaceDoc(token: string, id: string, html: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id,trashed`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/html; charset=UTF-8' },
    body: html,
    signal: AbortSignal.timeout(20_000),
  });
  await checkDrive(res);
}

/** The doc's current content, as markdown when Google can export it, else plain text. */
async function readDoc(token: string, id: string): Promise<string> {
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=trashed`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  await checkDrive(meta);
  if ((await meta.json()).trashed) throw new GoogleError('MISSING_DOC');
  for (const mime of ['text/markdown', 'text/plain']) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(mime)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
    );
    if (res.ok) return (await res.text()).replace(/^﻿/, '').slice(0, MAX_DOC_CHARS);
    if (res.status === 401 || res.status === 404) await checkDrive(res);
  }
  return '';
}

// ---- Markdown -> HTML for Google Docs ----

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<span style="font-family:Courier New">$1</span>');
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((bullet || numbered)![1])}</li>`);
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      closeList();
      out.push('<hr>');
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return `<html><head><meta charset="utf-8"></head><body>${out.join('\n')}</body></html>`;
}

// ---- The writer ----

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];

const WRITER_PROMPT = `You keep a student's live Google Doc up to date while they study with TaskTrack AI.
You are given the task, the doc as it is now, and the recent study chat. Reply with the COMPLETE
updated doc in markdown, and nothing else (no code fences, no comments about what you changed).

How to update it:
- Start with "# " and a clear title. Organise with "## " sections, short paragraphs, "- " bullets,
  numbered steps, and **bold** key terms. Keep it clean and easy to revise from.
- Fold in what the latest exchange added: explanations, key ideas, worked examples, vocab,
  quiz mistakes to revisit, the study plan, decisions the student made. Put each thing in the
  right section instead of just appending a transcript. Never copy the chat word for word.
- If the student's latest message asks for something about the doc ("add a section on…",
  "make it shorter", "turn this into a table of key dates", "fix the headings"), do it.
- KEEP everything the student wrote in the doc themselves, in their own words. You may tidy
  its formatting, but never delete or rewrite their sentences unless they asked you to.
- Be accurate. Never invent facts, quotes, sources or statistics.

Academic honesty (always):
- If the task is graded writing (an essay, IA, EE, TOK essay, lab report, coursework, or a
  summative/formative written piece), do NOT write the work the student will hand in: no
  finished paragraphs, introductions, conclusions or full drafts. Instead build the doc around
  an outline with short bullet points, the student's own thesis and ideas, evidence to use,
  a checklist against the assessment criteria, and feedback on drafts the student wrote.
- If they ask you to write it for them, keep the outline and add one short line in the doc:
  "TaskTrack helps you plan and improve your own writing; it won't write the graded piece."
- Study notes, revision guides, vocab lists, summaries of their class material, practice
  questions and plans are all fine to write in full.`;

async function writeWithAi(
  apiKey: string,
  context: { task: string; doc: string; chat: string }
): Promise<string | null> {
  const messages = [
    { role: 'system', content: WRITER_PROMPT },
    {
      role: 'user',
      content:
        `TASK\n${context.task}\n\n` +
        `CURRENT DOC (markdown)\n<<<\n${context.doc || '(empty)'}\n>>>\n\n` +
        `RECENT STUDY CHAT (oldest first)\n${context.chat}\n\n` +
        `Write the complete updated doc now.`,
    },
  ];
  for (const model of MODELS) {
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.4,
          max_completion_tokens: 6000,
          ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        console.error(`Doc writer failed (${model}):`, res.status);
        continue;
      }
      const data = await res.json();
      let text: string = (data?.choices?.[0]?.message?.content || '').trim();
      text = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
      if (text.length > 40) return text.slice(0, MAX_DOC_CHARS);
    } catch (err) {
      console.error(`Doc writer error (${model}):`, err instanceof Error ? err.message : 'unknown');
    }
  }
  return null;
}

// ---- Handlers ----

function appRedirect(returnTo: string | null, result: string): Response {
  const path = returnTo && /^\/app(\/[\w\-/]*)?$/.test(returnTo) ? returnTo : '/app/study-sessions';
  return new Response(null, { status: 302, headers: { Location: `${APP_URL}${path}?gdocs=${result}` } });
}

async function handleCallback(admin: Admin, encKey: string, url: URL): Promise<Response> {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code');
  const googleError = url.searchParams.get('error');

  const { data: pending } = state
    ? await admin.from('google_docs_oauth_states').select('user_id, return_to, created_at').eq('state', state).maybeSingle()
    : { data: null };
  if (state) await admin.from('google_docs_oauth_states').delete().eq('state', state);
  const returnTo = (pending?.return_to as string | null) ?? null;

  if (googleError) return appRedirect(returnTo, googleError === 'access_denied' ? 'cancelled' : 'blocked');
  if (!pending || !code || Date.now() - new Date(pending.created_at).getTime() > STATE_TTL_MS) return appRedirect(returnTo, 'expired');

  const creds = googleCreds();
  if (!creds) return appRedirect(returnTo, 'unavailable');

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
    console.error('Docs token exchange failed with status', res.status);
    return appRedirect(returnTo, 'failed');
  }
  if (!String(tokens.scope || '').includes('auth/drive.file')) return appRedirect(returnTo, 'scopes');

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
    .from('google_docs_connections')
    .select('enc_refresh_token')
    .eq('user_id', pending.user_id)
    .maybeSingle();
  const encRefresh = typeof tokens.refresh_token === 'string'
    ? await encrypt(encKey, tokens.refresh_token)
    : existing?.enc_refresh_token;
  if (!encRefresh) return appRedirect(returnTo, 'failed');

  await admin.from('google_docs_connections').upsert({
    user_id: pending.user_id,
    google_email: googleEmail,
    enc_refresh_token: encRefresh,
    status: 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return appRedirect(returnTo, 'connected');
}

interface SessionInfo {
  id: string;
  title: string;
  task: { title: string; description: string | null; category: string | null; due_date: string | null; subject: { name: string } | null } | null;
}

function describeTask(s: SessionInfo): string {
  const t = s.task;
  const lines = [`Title: ${t?.title || s.title}`];
  if (t?.subject?.name) lines.push(`Subject: ${t.subject.name}`);
  if (t?.category) lines.push(`Category: ${t.category}`);
  if (t?.due_date) lines.push(`Due: ${t.due_date}`);
  if (t?.description) lines.push(`Details: ${t.description.slice(0, 1500)}`);
  return lines.join('\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  let refund: (() => Promise<void>) | null = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ ok: false, error: 'Google Docs is unavailable right now.' }, 503);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: secrets } = await admin.from('integration_secrets').select('enc_key').eq('id', 1).maybeSingle();
    if (!secrets?.enc_key) return json({ ok: false, error: 'Google Docs is unavailable right now.' }, 503);

    if (req.method === 'GET') return await handleCallback(admin, secrets.enc_key, new URL(req.url));
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;

    const { data: connection } = await admin
      .from('google_docs_connections')
      .select('id, google_email, enc_refresh_token, status')
      .eq('user_id', userId)
      .maybeSingle();

    const sessionDoc = async () => sessionId
      ? (await admin
          .from('study_session_docs')
          .select('id, google_doc_id, doc_url, title, auto_update, last_written_at')
          .eq('user_id', userId)
          .eq('session_id', sessionId)
          .maybeSingle()).data
      : null;

    if (action === 'status') {
      const doc = await sessionDoc();
      return json({
        ok: true,
        connected: Boolean(connection) && connection?.status === 'active',
        needsReconnect: connection?.status === 'reconnect',
        email: connection?.google_email ?? null,
        doc: doc
          ? { url: doc.doc_url, title: doc.title, autoUpdate: doc.auto_update, lastWrittenAt: doc.last_written_at }
          : null,
      });
    }

    if (action === 'start') {
      const creds = googleCreds();
      if (!creds) return json({ ok: false, error: 'Google Docs is not set up on TaskTrack yet.' }, 503);
      const returnTo = typeof body?.returnTo === 'string' && /^\/app(\/[\w\-/]*)?$/.test(body.returnTo) ? body.returnTo : '/app/study-sessions';
      const state = randomState();
      await admin.from('google_docs_oauth_states').delete().lt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString());
      await admin.from('google_docs_oauth_states').insert({ state, user_id: userId, return_to: returnTo });
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

    if (action === 'disconnect') {
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
          // best effort
        }
        await admin.from('study_session_docs').delete().eq('user_id', userId);
        await admin.from('google_docs_connections').delete().eq('id', connection.id);
      }
      return json({ ok: true });
    }

    if (!sessionId) return json({ ok: false, error: 'Open a study session first.' }, 400);

    if (action === 'unlink') {
      await admin.from('study_session_docs').delete().eq('user_id', userId).eq('session_id', sessionId);
      return json({ ok: true });
    }

    if (action !== 'create' && action !== 'update') return json({ ok: false, error: 'Unknown action.' }, 400);
    if (!connection || connection.status !== 'active') {
      return json({ ok: false, code: 'NOT_CONNECTED', error: 'Connect Google Docs first.' }, 400);
    }

    // The session must be the student's own (read as them, through RLS).
    const { data: session } = await userClient
      .from('study_sessions')
      .select('id, title, task:tasks(title, description, category, due_date, subject:subjects(name))')
      .eq('id', sessionId)
      .maybeSingle();
    if (!session) return json({ ok: false, error: 'That study session could not be found.' }, 404);
    const info = session as unknown as SessionInfo;

    let token: string;
    try {
      token = await accessTokenFor(await decrypt(secrets.enc_key, connection.enc_refresh_token));
    } catch (err) {
      if (err instanceof GoogleError && err.code === 'RECONNECT') {
        await admin.from('google_docs_connections').update({ status: 'reconnect' }).eq('id', connection.id);
      }
      return json({ ok: false, code: 'RECONNECT', error: safeMessage(err) }, 400);
    }

    let doc = await sessionDoc();

    const { data: messageRows } = await userClient
      .from('study_session_messages')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(20);
    const recent = (messageRows ?? []).reverse() as { role: string; content: string }[];

    if (action === 'create' && !doc) {
      const title = `${(info.task?.title || info.title).slice(0, 80)} · TaskTrack notes`;
      const starter =
        `# ${info.task?.title || info.title}\n\n` +
        `${info.task?.subject?.name ? `**Subject:** ${info.task.subject.name}  \n` : ''}` +
        `*Live notes from your TaskTrack study session. Keep chatting and this doc updates itself. ` +
        `You can type in it too; TaskTrack keeps what you write.*\n\n## Notes\n\n- Nothing yet. Ask the study AI something to get started.`;
      try {
        const created = await createDoc(token, title, markdownToHtml(starter));
        const { data: row } = await admin
          .from('study_session_docs')
          .insert({ user_id: userId, session_id: sessionId, google_doc_id: created.id, doc_url: created.url, title })
          .select('id, google_doc_id, doc_url, title, auto_update, last_written_at')
          .maybeSingle();
        doc = row;
      } catch (err) {
        return json({ ok: false, code: err instanceof GoogleError ? err.code : 'UNAVAILABLE', error: safeMessage(err) }, 502);
      }
      // A brand-new session has nothing to write yet.
      if (recent.length === 0) {
        return json({ ok: true, doc: { url: doc!.doc_url, title: doc!.title, autoUpdate: doc!.auto_update, lastWrittenAt: null } });
      }
    }

    if (!doc) return json({ ok: false, code: 'NO_DOC', error: 'Create a live doc for this session first.' }, 400);
    if (recent.length === 0) {
      return json({ ok: true, doc: { url: doc.doc_url, title: doc.title, autoUpdate: doc.auto_update, lastWrittenAt: doc.last_written_at } });
    }

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) return json({ ok: false, error: 'TaskTrack AI is not configured yet.' }, 503);

    // One AI credit per rewrite, charged before the work and refunded if it fails.
    const { data: reserveData, error: reserveError } = await userClient.rpc('reserve_ai_credits', { p_cost: UPDATE_COST });
    const reservation = Array.isArray(reserveData) ? reserveData[0] : reserveData;
    if (reserveError) return json({ ok: false, error: 'TaskTrack AI is unavailable right now.' }, 502);
    if (!reservation?.allowed) {
      return json({ ok: false, code: 'QUOTA_EXCEEDED', error: "You've used all your AI credits for this month." }, 429);
    }
    refund = async () => {
      await admin.rpc('refund_ai_credits_for', { p_user: userId, p_cost: UPDATE_COST });
    };

    let current = '';
    try {
      current = await readDoc(token, doc.google_doc_id);
    } catch (err) {
      await refund();
      refund = null;
      if (err instanceof GoogleError && err.code === 'MISSING_DOC') {
        await admin.from('study_session_docs').delete().eq('id', doc.id);
      }
      return json({ ok: false, code: err instanceof GoogleError ? err.code : 'UNAVAILABLE', error: safeMessage(err) }, 502);
    }

    let budget = 18_000;
    const chatLines: string[] = [];
    for (const m of [...recent].reverse()) {
      const line = `${m.role === 'user' ? 'Student' : 'TaskTrack AI'}: ${String(m.content || '').slice(0, 3000)}`;
      if (budget - line.length < 0) break;
      budget -= line.length;
      chatLines.unshift(line);
    }

    const updated = await writeWithAi(apiKey, { task: describeTask(info), doc: current, chat: chatLines.join('\n\n') });
    if (!updated) {
      await refund();
      refund = null;
      return json({ ok: false, error: 'The doc could not be updated right now. Please try again.' }, 502);
    }

    try {
      await replaceDoc(token, doc.google_doc_id, markdownToHtml(updated));
    } catch (err) {
      await refund();
      refund = null;
      return json({ ok: false, code: err instanceof GoogleError ? err.code : 'UNAVAILABLE', error: safeMessage(err) }, 502);
    }
    refund = null;

    const now = new Date().toISOString();
    await admin.from('study_session_docs').update({ last_written_at: now, updated_at: now }).eq('id', doc.id);
    return json({ ok: true, doc: { url: doc.doc_url, title: doc.title, autoUpdate: doc.auto_update, lastWrittenAt: now } });
  } catch (err) {
    console.error('google-docs failed:', err instanceof Error ? err.message : 'unknown');
    if (refund) await refund().catch(() => undefined);
    return json({ ok: false, error: 'Something went wrong with Google Docs. Please try again.' }, 500);
  }
});
