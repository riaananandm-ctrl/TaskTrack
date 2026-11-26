import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * CAS AI helpers. One function, four actions:
 *   coach     -> { questions: string[] }             2-3 questions, never reflection text
 *   outcomes  -> { outcomes: [{ id, confidence, reason }] }
 *   vague     -> { flags: [{ sentence, issue, prompt }] }
 *   brief     -> { brief: string }                   for the supervisor, not the student's reflection
 *
 * No action ever returns reflection prose for the student to paste. Every call is
 * logged and limited to 20 per student per day (cas_ai_reserve). Any failure returns
 * ok:false and the page simply hides its AI panel.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function fail(code: string, message: string, status = 200): Response {
  return json({ ok: false, error: { code, message } }, status);
}

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];

const PROMPTS = {
  coach: `You are a CAS reflection coach for IB students. Your job is to help the student
think more specifically about their experience. You must NEVER write reflection
text for them, rewrite their sentences, or produce anything they could paste in.
Respond with exactly 2-3 questions that push for concrete detail: a decision they
made, a difficulty they hit, a person they worked with, or something that changed
in their thinking. Keep each question under 20 words. No praise, no summary.
Return JSON only: { "questions": ["...", "..."] }`,
  outcomes: `Map this reflection to the IB CAS learning outcomes. Return JSON only:
{ "outcomes": [ { "id": 1-7, "confidence": 0-1, "reason": "one sentence" } ] }
Only include outcomes with confidence above 0.5. Never invent outcomes.
The seven outcomes are: 1 identify own strengths and develop areas for growth,
2 demonstrate challenges undertaken and skills developed, 3 demonstrate
initiative and planning, 4 work collaboratively, 5 show perseverance and
commitment, 6 engage with issues of global significance, 7 recognise and
consider ethics of choices and actions.
Be strict: an outcome counts only when the student describes a specific moment or
action that shows it, in their own words. Do not infer outcomes from what the activity
usually involves. A typical reflection evidences 1 to 3 outcomes.`,
  vague: `Find sentences that are vague or generic, such as "I learned a lot", "it was fun",
"it was a good experience". Return JSON only:
{ "flags": [ { "sentence": "...", "issue": "why it is vague", "prompt": "a question that would fix it" } ] }
Maximum 3 flags. If the reflection is specific, return an empty array.
Each "sentence" must be copied exactly from the reflection.`,
  brief: `Write a five-line brief for a CAS supervisor before an interview. Cover: what the
student did, hours by strand, which outcomes are evidenced, and the two biggest
gaps. Plain prose, no bullet points, no praise, under 120 words.
Return JSON only: { "brief": "..." }`,
} as const;
type Action = keyof typeof PROMPTS;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '';
}
function oneLine(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function reflectionText(body: Record<string, unknown>): string {
  const r = (body.reflection && typeof body.reflection === 'object' ? body.reflection : {}) as Record<string, unknown>;
  return [
    r.what_i_did ? `What I did: ${str(r.what_i_did, 4000)}` : '',
    r.what_i_learned ? `What I learned: ${str(r.what_i_learned, 4000)}` : '',
    r.outcome_evidence ? `Which outcome and how: ${str(r.outcome_evidence, 4000)}` : '',
  ].filter(Boolean).join('\n\n');
}

function userMessage(action: Action, body: Record<string, unknown>): string | null {
  if (action === 'brief') {
    const items = Array.isArray(body.experiences) ? body.experiences.slice(0, 60) : [];
    if (!items.length) return null;
    const lines = items.map((e: Record<string, unknown>) => {
      const strands = Array.isArray(e.strands) ? e.strands.map((s) => oneLine(s, 20)).join('+') : '';
      const outcomes = Array.isArray(e.outcomes) ? e.outcomes.filter((n) => Number.isInteger(n)).join(',') : '';
      return `- ${oneLine(e.title, 120)} [${strands}] ${Number(e.hours) || 0}h; outcomes: ${outcomes || 'none'}; ` +
        `verified: ${oneLine(e.verification_status, 12) || 'pending'}; reflection: ${oneLine(e.reflection, 500) || '(none)'}`;
    });
    const totals = body.totals && typeof body.totals === 'object' ? JSON.stringify(body.totals).slice(0, 200) : '';
    return `HOURS BY STRAND: ${totals}\nEXPERIENCES:\n${lines.join('\n')}`;
  }
  const text = reflectionText(body);
  if (!text || words(text) < 3) return null;
  if (action === 'coach') {
    const strands = Array.isArray(body.strands) ? body.strands.map((s) => oneLine(s, 20)).join(', ') : oneLine(body.strand, 40);
    return `Experience: ${oneLine(body.title, 200)}\nStrand: ${strands}\n\nReflection:\n${text}`;
  }
  return `Reflection:\n${text}`;
}

// Clean each action's output; anything off-shape is dropped, never passed through.
function clean(action: Action, raw: Record<string, unknown>, source: string): Record<string, unknown> | null {
  if (action === 'coach') {
    const qs = (Array.isArray(raw.questions) ? raw.questions : [])
      .map((q) => oneLine(q, 200))
      .filter((q) => q.endsWith('?') && words(q) <= 20)
      .slice(0, 3);
    return qs.length >= 2 ? { questions: qs } : null;
  }
  if (action === 'outcomes') {
    const seen = new Set<number>();
    const outcomes = (Array.isArray(raw.outcomes) ? raw.outcomes : [])
      .map((o: Record<string, unknown>) => ({
        id: Number(o?.id),
        confidence: Math.round(Math.min(1, Math.max(0, Number(o?.confidence) || 0)) * 100) / 100,
        reason: oneLine(o?.reason, 200),
      }))
      .filter((o) => Number.isInteger(o.id) && o.id >= 1 && o.id <= 7 && o.confidence > 0.5 && !seen.has(o.id) && seen.add(o.id))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 4);
    return { outcomes };
  }
  if (action === 'vague') {
    const flat = source.replace(/\s+/g, ' ').toLowerCase();
    const flags = (Array.isArray(raw.flags) ? raw.flags : [])
      .map((f: Record<string, unknown>) => ({
        sentence: oneLine(f?.sentence, 300),
        issue: oneLine(f?.issue, 200),
        prompt: oneLine(f?.prompt, 200),
      }))
      // Only sentences the student actually wrote, and the fix is a question, not new text.
      .filter((f) => f.sentence && flat.includes(f.sentence.toLowerCase().replace(/[.!]+$/, '')) && f.prompt.endsWith('?'))
      .slice(0, 3);
    return { flags };
  }
  const brief = oneLine(raw.brief, 1200);
  if (!brief || words(brief) > 140) return null;
  return { brief };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return fail('METHOD', 'Method not allowed.', 405);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!url || !anon || !apiKey) return fail('UNAVAILABLE', 'CAS AI is not available right now.', 503);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('AUTH', 'Please sign in again and retry.', 401);
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user?.id) return fail('AUTH', 'Please sign in again and retry.', 401);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action as Action;
    if (!body || !(action in PROMPTS)) return fail('BAD_REQUEST', 'Unknown CAS AI action.', 400);

    const message = userMessage(action, body);
    if (!message) return fail('TOO_SHORT', 'Write a little more first.');

    const { data: reserve, error: reserveError } = await userClient.rpc('cas_ai_reserve', { p_endpoint: action });
    if (reserveError) return fail('UNAVAILABLE', 'CAS AI is not available right now.', 502);
    if (!reserve?.allowed) {
      return reserve?.error === 'daily_limit'
        ? fail('DAILY_LIMIT', "You've used today's 20 CAS AI checks. They reset at midnight.", 429)
        : fail('UNAVAILABLE', 'CAS AI is not available right now.', 502);
    }

    for (const model of MODELS) {
      try {
        const res = await fetch(GROQ_CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_completion_tokens: 900,
            response_format: { type: 'json_object' },
            ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
            messages: [
              { role: 'system', content: PROMPTS[action] },
              { role: 'user', content: message },
            ],
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          console.error(`cas-ai ${action} failed (${model}):`, res.status);
          continue;
        }
        const data = await res.json();
        const text = String(data?.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*|```\s*$/g, '');
        const result = clean(action, JSON.parse(text), message);
        if (result) return json({ ok: true, ...result, used: reserve.used, limit: reserve.limit });
      } catch (err) {
        console.error(`cas-ai ${action} error (${model}):`, err instanceof Error ? err.message : 'unknown');
      }
    }
    return fail('AI_FAILED', 'CAS AI could not answer right now.', 502);
  } catch (err) {
    console.error('cas-ai error:', err instanceof Error ? err.message : 'unknown');
    return fail('UNAVAILABLE', 'CAS AI is not available right now.', 500);
  }
});
