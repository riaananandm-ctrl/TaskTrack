import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Whiteboard tutor (Premium and Max only). The student sends a picture of what is on
 * their whiteboard plus a question. The tutor looks at the drawing, explains, and can
 * add simple marks of its own (arrows, circles, lines, boxes, short labels) that the
 * app draws on the board in a separate colour.
 *
 * It teaches: it explains, points things out and shows worked steps for practice, but
 * it does not complete graded work for the student.
 *
 * Credits: 2 are reserved up front, then a large request is charged by token use
 * (charge_ai_tokens_for). A failed request is refunded.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const COST = 2;
const MAX_IMAGE_CHARS = 2_800_000; // ~2 MB of base64
const MAX_QUESTION_CHARS = 1500;
const MAX_DRAWINGS = 25;
const MODEL_TIMEOUT_MS = 45_000;

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_VISION_MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];

const COLORS = ['#7c3aed', '#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#1e293b'];

type Drawing =
  | { type: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { type: 'circle'; cx: number; cy: number; r: number; color: string }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { type: 'path'; points: [number, number][]; color: string };

async function serviceRpc(userClient: ReturnType<typeof createClient>, fn: string, args: Record<string, unknown>) {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const { data } = await userClient.auth.getUser();
    if (!url || !key || !data?.user) return null;
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: out, error } = await admin.rpc(fn, { p_user: data.user.id, ...args });
    if (error) console.error(`${fn} failed:`, error.message);
    return out;
  } catch (e) {
    console.error(`${fn} failed:`, e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

function num(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, lo), hi);
}

function cleanDrawings(raw: unknown, w: number, h: number): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  for (const d of raw.slice(0, MAX_DRAWINGS)) {
    if (!d || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    const color = typeof o.color === 'string' && COLORS.includes(o.color.toLowerCase()) ? o.color.toLowerCase() : COLORS[0];
    const X = (v: unknown) => num(v, -w, 2 * w);
    const Y = (v: unknown) => num(v, -h, 2 * h);
    if (o.type === 'line' || o.type === 'arrow') {
      const [x1, y1, x2, y2] = [X(o.x1), Y(o.y1), X(o.x2), Y(o.y2)];
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) out.push({ type: o.type, x1, y1, x2, y2, color });
    } else if (o.type === 'rect') {
      const [x, y, rw, rh] = [X(o.x), Y(o.y), num(o.w, 1, 2 * w), num(o.h, 1, 2 * h)];
      if (x !== null && y !== null && rw !== null && rh !== null) out.push({ type: 'rect', x, y, w: rw, h: rh, color });
    } else if (o.type === 'circle') {
      const [cx, cy, r] = [X(o.cx), Y(o.cy), num(o.r, 2, Math.max(w, h))];
      if (cx !== null && cy !== null && r !== null) out.push({ type: 'circle', cx, cy, r, color });
    } else if (o.type === 'text' && typeof o.text === 'string' && o.text.trim()) {
      const [x, y] = [X(o.x), Y(o.y)];
      const size = num(o.size, 12, 48) ?? 20;
      if (x !== null && y !== null) out.push({ type: 'text', x, y, text: o.text.trim().slice(0, 80), color, size });
    } else if (o.type === 'path' && Array.isArray(o.points)) {
      const pts: [number, number][] = [];
      for (const p of (o.points as unknown[]).slice(0, 200)) {
        if (!Array.isArray(p)) continue;
        const [px, py] = [X(p[0]), Y(p[1])];
        if (px !== null && py !== null) pts.push([px, py]);
      }
      if (pts.length >= 2) out.push({ type: 'path', points: pts, color });
    }
  }
  return out;
}

function parseReply(text: string): { reply: string; drawings: unknown } | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof obj.reply !== 'string' || !obj.reply.trim()) return null;
    return { reply: obj.reply.trim().slice(0, 6000), drawings: obj.drawings };
  } catch {
    return null;
  }
}

async function askVision(
  url: string, key: string, model: string, system: string, question: string, image: string,
): Promise<{ text: string; tokens: number } | null> {
  const payload: Record<string, unknown> = {
    model,
    temperature: 0.4,
    max_completion_tokens: 2000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: image } }] },
    ],
  };
  if (model.startsWith('gemini')) payload.reasoning_effort = 'none';
  const send = async (body: Record<string, unknown>) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
  let res = await send(payload);
  if (res.status === 400) {
    // Some models reject JSON mode or the reasoning setting; try once without them.
    const { response_format: _r, reasoning_effort: _e, ...plain } = payload;
    res = await send(plain);
  }
  const raw = await res.text();
  if (!res.ok) {
    console.error(`Tutor model failed (${model}):`, res.status, raw.slice(0, 300));
    return null;
  }
  try {
    const data = JSON.parse(raw) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text ? { text, tokens: Number(data.usage?.total_tokens) || 0 } : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  let supabase: ReturnType<typeof createClient> | null = null;
  let reserved = false;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!supabaseUrl || !anonKey || (!geminiKey && !groqKey)) {
      return json({ ok: false, error: 'The whiteboard tutor is unavailable right now.' }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return json({ ok: false, error: 'Please sign in again and retry.' }, 401);

    // Premium and Max only. The plan comes from the database, never the request.
    const { data: access } = await supabase.rpc('get_tool_access');
    const plan = (access as Record<string, unknown> | null)?.plan;
    if (plan !== 'pro' && plan !== 'max') {
      return json({ ok: false, reason: 'premium', error: 'The whiteboard tutor is part of Premium and Max.' }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : '';
    const image = typeof body.image === 'string' ? body.image : '';
    const width = num(body.width, 50, 4000);
    const height = num(body.height, 50, 4000);
    if (!question) return json({ ok: false, error: 'Type a question for the tutor.' }, 400);
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE_CHARS || !width || !height) {
      return json({ ok: false, error: 'The whiteboard picture could not be read. Please try again.' }, 400);
    }

    const { data: reserveData, error: reserveError } = await supabase.rpc('reserve_ai_credits', { p_cost: COST });
    if (reserveError) return json({ ok: false, error: 'The whiteboard tutor is unavailable right now.' }, 503);
    const reservation = Array.isArray(reserveData) ? reserveData[0] : reserveData;
    if (!reservation?.allowed) {
      return json({ ok: false, reason: 'credits', error: 'You’ve used all your AI credits for this month. They refill on the 1st.' }, 429);
    }
    reserved = true;

    const W = Math.round(width);
    const H = Math.round(height);
    const system = `You are a friendly, patient tutor looking at a student's whiteboard (the image, ${W}x${H} pixels, origin top-left, x to the right, y down). It may hold maths, science diagrams, notes or an art sketch.
Teach like a teacher standing beside them: describe what you see, say what is right, point out mistakes, and explain the next step. For art, give specific feedback on shape, proportion, perspective, shading and composition.
Academic integrity: help the student learn. If it looks like graded work (an assessment, IA, test or homework to hand in), give hints, explanations and a similar worked example, but do not hand over the finished answer to their exact question.
You may draw on the board to show things: circle a mistake, add an arrow, a guide line, a box or a short label. Use the image's pixel coordinates. Keep marks few (at most ${MAX_DRAWINGS}) and placed next to what they refer to.
Reply with ONLY a JSON object:
{"reply": "your explanation, plain text with no markdown or asterisks, short paragraphs, under 250 words",
 "drawings": [
  {"type":"circle","cx":0,"cy":0,"r":0,"color":"#ef4444"},
  {"type":"arrow","x1":0,"y1":0,"x2":0,"y2":0,"color":"#7c3aed"},
  {"type":"line","x1":0,"y1":0,"x2":0,"y2":0,"color":"#3b82f6"},
  {"type":"rect","x":0,"y":0,"w":0,"h":0,"color":"#22c55e"},
  {"type":"text","x":0,"y":0,"text":"short label","size":20,"color":"#7c3aed"},
  {"type":"path","points":[[0,0],[10,10]],"color":"#f59e0b"}
 ]}
Colours must be one of ${COLORS.join(', ')}. Use "drawings": [] if no marks help. If the board is empty, say so and help with the question anyway.`;

    const attempts: Array<[string, string, string]> = [];
    if (geminiKey) for (const m of GEMINI_MODELS) attempts.push([GEMINI_URL, geminiKey, m]);
    if (groqKey) for (const m of GROQ_VISION_MODELS) attempts.push([GROQ_URL, groqKey, m]);

    let tokens = 0;
    for (const [url, key, model] of attempts) {
      let out: { text: string; tokens: number } | null = null;
      try {
        out = await askVision(url, key, model, system, question, image);
      } catch (e) {
        console.error(`Tutor model threw (${model}):`, e instanceof Error ? e.message : 'unknown');
      }
      if (!out) continue;
      tokens += out.tokens;
      const parsed = parseReply(out.text);
      const reply = parsed?.reply ?? (out.text.trim().startsWith('{') ? '' : out.text.trim().slice(0, 6000));
      if (!reply) continue;
      const drawings = cleanDrawings(parsed?.drawings, W, H);
      const extraRaw = await serviceRpc(supabase, 'charge_ai_tokens_for', { p_tokens: Math.round(tokens), p_base_cost: COST });
      const extra = typeof extraRaw === 'number' ? extraRaw : 0;
      return json({
        ok: true,
        reply,
        drawings,
        usage: {
          cost: COST + extra,
          used: reservation.used + extra,
          limit: reservation.credit_limit,
          remaining: Math.max(reservation.remaining - extra, 0),
        },
      });
    }

    await serviceRpc(supabase, 'refund_ai_credits_for', { p_cost: COST });
    reserved = false;
    return json({ ok: false, error: 'The tutor is busy right now. Please try again in a minute. Your credits were not used.' }, 503);
  } catch (e) {
    console.error('Whiteboard tutor failed:', e instanceof Error ? e.message : 'unknown');
    if (supabase && reserved) await serviceRpc(supabase, 'refund_ai_credits_for', { p_cost: COST });
    return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }
});
