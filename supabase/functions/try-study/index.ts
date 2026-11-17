import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Homepage "Try it": a visitor types a school topic and gets a small AI study set
 * (a short explanation, 4 flashcards and a 3-question quiz) without signing up.
 *
 * No account is involved, so abuse is limited on the server: 5 tries per visitor per
 * day and 400 for everyone per day (see try_demo_reserve). Visitors are counted by an
 * HMAC of their IP and the date; the IP itself is never stored. Off-topic or unsafe
 * topics are refused by the model and by a short word list.
 */

const ALLOWED_ORIGINS = ['https://tasktrackbm.vercel.app', 'http://localhost:3000', 'http://localhost:3001'];

function cors(origin: string | null): Record<string, string> {
  const allow = origin && (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/tasktrack[a-z0-9-]*\.vercel\.app$/.test(origin))
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
    Vary: 'Origin',
  };
}

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'];
const MODEL_TIMEOUT_MS = 25_000;
const MAX_TOPIC = 80;

// A first filter; the model is also told to refuse anything that isn't schoolwork.
const BLOCKED = /\b(sex|porn|nude|kill|suicide|self[- ]?harm|drugs?|cocaine|weed|bomb|gun|nazi|hitler did nothing)\b/i;

const SYSTEM = `You make a tiny study set for a secondary-school (IB MYP/DP) student.
Reply with JSON only:
{"ok":true,"title":"<short topic title>","subject":"<school subject>","explain":["<3 short plain-English points>"],
 "cards":[{"front":"<question>","back":"<answer, max 25 words>"}],
 "quiz":[{"question":"...","options":["A","B","C","D"],"answer":<index 0-3>,"why":"<one sentence>"}]}
Rules: exactly 3 explain points, 4 cards, 3 quiz questions. Facts must be correct and suitable for students aged 11-18.
If the topic is not a school or general-knowledge study topic, or is unsafe, rude or about a real private person, reply {"ok":false}.`;

async function hmac(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function askJson(apiKey: string, topic: string): Promise<unknown | null> {
  for (const model of MODELS) {
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: model.startsWith('openai/gpt-oss') ? 2600 : 1100,
          response_format: { type: 'json_object' },
          ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `Topic: ${topic}` },
          ],
        }),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error('try-study: model failed', model, res.status);
        continue;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') continue;
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end <= start) continue;
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      console.error('try-study: request or parse failed', model);
    }
  }
  return null;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Keeps only well-formed parts of the model's answer, so the page never shows junk. */
function clean(raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.ok !== true) return null;
  const explain = (Array.isArray(r.explain) ? r.explain : []).map((p) => str(p, 240)).filter(Boolean).slice(0, 3);
  const cards = (Array.isArray(r.cards) ? r.cards : [])
    .map((c) => ({ front: str((c as Record<string, unknown>)?.front, 160), back: str((c as Record<string, unknown>)?.back, 220) }))
    .filter((c) => c.front && c.back)
    .slice(0, 4);
  const quiz = (Array.isArray(r.quiz) ? r.quiz : [])
    .map((q) => {
      const o = (q ?? {}) as Record<string, unknown>;
      const options = (Array.isArray(o.options) ? o.options : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 4);
      const answer = typeof o.answer === 'number' ? Math.trunc(o.answer) : Number(o.answer);
      return { question: str(o.question, 200), options, answer, why: str(o.why, 240) };
    })
    .filter((q) => q.question && q.options.length === 4 && q.answer >= 0 && q.answer < 4)
    .slice(0, 3);
  if (explain.length < 2 || cards.length < 2 || quiz.length < 1) return null;
  return { title: str(r.title, 80), subject: str(r.subject, 40), explain, cards, quiz };
}

Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get('Origin'));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!supabaseUrl || !serviceKey || !apiKey) return json({ ok: false, error: 'The demo is unavailable right now.' }, 503);

    const body = await req.json().catch(() => ({}));
    const topic = str(body?.topic, MAX_TOPIC + 1).replace(/\s+/g, ' ');
    if (topic.length < 2) return json({ ok: false, error: 'Type a topic first, like “photosynthesis”.' }, 400);
    if (topic.length > MAX_TOPIC) return json({ ok: false, error: 'Keep the topic short (under 80 characters).' }, 400);
    if (BLOCKED.test(topic)) return json({ ok: false, error: 'Try a school topic, like “the French Revolution”.' }, 400);

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
    const day = new Date().toISOString().slice(0, 10);
    const visitor = await hmac(serviceKey, `${ip}|${day}`);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: status, error } = await admin.rpc('try_demo_reserve', { p_visitor: visitor });
    if (error) {
      console.error('try-study: reserve failed');
      return json({ ok: false, error: 'The demo is unavailable right now.' }, 503);
    }
    if (status === 'limit') return json({ ok: false, error: 'That’s all the free tries for today. Sign up free to keep going.', limit: true }, 429);
    if (status === 'busy') return json({ ok: false, error: 'The demo is very busy today. Sign up free to use the full version.', limit: true }, 429);

    const set = clean(await askJson(apiKey, topic));
    if (!set) return json({ ok: false, error: 'That one didn’t work. Try a school topic, like “cell division”.' }, 422);
    return json({ ok: true, set });
  } catch (err) {
    console.error('try-study failed:', err instanceof Error ? err.message : 'unknown');
    return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }
});
