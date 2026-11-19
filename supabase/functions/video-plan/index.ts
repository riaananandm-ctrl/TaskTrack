import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Video plan for a study session: an ordered course of YouTube videos (Video 1,
 * Video 2…) that takes the student from the basics of the task's topic to
 * exam-ready, split into days before the due date. Costs 1 AI credit, refunded if
 * the plan can't be made.
 *
 * Request:  { task: { title, subject, description, category, dueDate }, messages: [{ role, content }] }
 * Response: { ok: true, mode: "videos", text, structured: { summary, videos: [...] } }
 *
 * The AI never gives URLs or claims exact titles: each video is a description plus
 * YouTube search words, and the in-app player (find-video) picks a real, embeddable,
 * safe-search educational video for each one.
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

const COST = 1;
const MIN_VIDEOS = 5;
const MAX_VIDEOS = 10;
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];

const PROMPT = `You build a VIDEO PLAN for a high-school (IB) student: an ordered list of YouTube videos
that takes them from the basics of their task's topic to confident and exam-ready.

Rules:
- ${MIN_VIDEOS} to ${MAX_VIDEOS} videos, in the exact order to watch them. Start with the foundations,
  then build up step by step, and finish with exam technique or worked past-paper style questions.
- Each video covers ONE clear sub-topic. No two videos cover the same thing.
- Split the videos into days ("day": 1, 2, 3…), about 2 to 3 videos (20 to 40 minutes) per day.
  If the due date is close, use fewer days; never plan days after the due date.
- "search": specific YouTube search words that will find a good educational video for exactly
  that sub-topic. Include the subject, the sub-topic and the level (e.g. "IB", "GCSE", "beginner").
- "title": describe what the video teaches. Never invent a URL or claim an exact video title.
- "channel": a well-known educational channel that really covers this, or "" if unsure.
- "why": one short sentence on why this video comes at this point.
- "watchFor": one thing to note down while watching.
- "minutes": a realistic length estimate (5 to 25).
- Base it on the task and what the student said in the chat. If they named a sub-topic, focus on it.
- If the task is a graded written piece, the videos teach the skills and content; they never give
  the student an answer to copy, and no search asks for an example, model or sample answer to
  the task itself.

Reply with JSON only:
{"summary": "one or two friendly sentences on what the plan covers and how long it takes",
 "videos": [{"day": 1, "title": "...", "channel": "...", "search": "...", "why": "...", "watchFor": "...", "minutes": 10}]}`;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

interface PlanVideo {
  day: number | null;
  title: string;
  channel: string;
  search: string;
  why: string;
  watchFor: string;
  minutes: number | null;
}

function cleanPlan(raw: unknown): { summary: string; videos: PlanVideo[] } | null {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!root || !Array.isArray(root.videos)) return null;
  const seen = new Set<string>();
  const videos: PlanVideo[] = [];
  for (const item of root.videos) {
    if (!item || typeof item !== 'object') continue;
    const x = item as Record<string, unknown>;
    const title = str(x.title, 140);
    const search = str(x.search, 140) || title;
    if (!search) continue;
    const key = search.toLowerCase();
    // Never send a student hunting for a ready-made answer.
    if (/\b(model|sample|example) (answer|essay|paragraph|response)\b/i.test(search)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const day = Number(x.day);
    const minutes = Number(x.minutes);
    videos.push({
      day: Number.isInteger(day) && day >= 1 && day <= 14 ? day : null,
      title: title || search,
      channel: str(x.channel, 60),
      search,
      why: str(x.why, 240),
      watchFor: str(x.watchFor, 240),
      minutes: Number.isFinite(minutes) && minutes > 0 && minutes <= 120 ? Math.round(minutes) : null,
    });
    if (videos.length >= MAX_VIDEOS) break;
  }
  if (videos.length < 2) return null;
  // Days must run 1, 2, 3… in order; if the AI muddled them, drop the grouping.
  const days = videos.map((v) => v.day);
  const ordered = days.every((d, i) => d !== null && (i === 0 ? d === 1 : d >= days[i - 1]! && d <= days[i - 1]! + 1));
  if (!ordered) videos.forEach((v) => (v.day = null));
  return { summary: str(root.summary, 400), videos };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return fail('METHOD', 'Method not allowed.', 405);

  let refund: (() => Promise<void>) | null = null;
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!url || !anon || !service || !apiKey) return fail('UNAVAILABLE', 'TaskTrack AI is not configured yet.', 503);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('AUTH', 'Please sign in again and retry.', 401);
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return fail('AUTH', 'Please sign in again and retry.', 401);

    const body = await req.json().catch(() => null);
    const task = body?.task && typeof body.task === 'object' ? body.task : {};
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    const taskLines = [
      `Title: ${str(task.title, 200) || 'Study session'}`,
      task.subject ? `Subject: ${str(task.subject, 80)}` : '',
      task.category ? `Type: ${str(task.category, 40)}` : '',
      task.dueDate ? `Due: ${str(task.dueDate, 40)}` : '',
      task.description ? `Details: ${str(task.description, 1500)}` : '',
      `Today: ${new Date().toISOString().slice(0, 10)}`,
    ].filter(Boolean);
    const chat = messages
      .slice(-10)
      .map((m: { role?: unknown; content?: unknown }) =>
        `${m?.role === 'user' ? 'Student' : 'TaskTrack AI'}: ${str(m?.content, 1200)}`
      )
      .join('\n');

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: reserveData, error: reserveError } = await userClient.rpc('reserve_ai_credits', { p_cost: COST });
    const reservation = Array.isArray(reserveData) ? reserveData[0] : reserveData;
    if (reserveError) return fail('UNAVAILABLE', 'TaskTrack AI is unavailable right now.', 502);
    if (!reservation?.allowed) return fail('QUOTA_EXCEEDED', "You've used all your AI credits for this month.", 429);
    refund = async () => {
      await admin.rpc('refund_ai_credits_for', { p_user: userId, p_cost: COST });
    };

    let plan: ReturnType<typeof cleanPlan> = null;
    for (const model of MODELS) {
      try {
        const res = await fetch(GROQ_CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0.4,
            max_completion_tokens: 3000,
            response_format: { type: 'json_object' },
            ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
            messages: [
              { role: 'system', content: PROMPT },
              { role: 'user', content: `TASK\n${taskLines.join('\n')}\n\nRECENT CHAT\n${chat || '(none yet)'}\n\nMake the video plan now.` },
            ],
          }),
          signal: AbortSignal.timeout(40_000),
        });
        if (!res.ok) {
          console.error(`Video plan failed (${model}):`, res.status);
          continue;
        }
        const data = await res.json();
        const text = String(data?.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*|```\s*$/g, '');
        plan = cleanPlan(JSON.parse(text));
        if (plan) break;
      } catch (err) {
        console.error(`Video plan error (${model}):`, err instanceof Error ? err.message : 'unknown');
      }
    }

    if (!plan) {
      await refund();
      refund = null;
      return fail('AI_FAILED', 'The video plan could not be made right now. Please try again.', 502);
    }
    refund = null;

    const totalMinutes = plan.videos.reduce((sum, v) => sum + (v.minutes ?? 0), 0);
    const summary =
      plan.summary ||
      `${plan.videos.length} videos in order${totalMinutes ? `, about ${totalMinutes} minutes in total` : ''}.`;
    return json({
      ok: true,
      mode: 'videos',
      text: `Here's your video plan: ${summary}`,
      structured: { summary, videos: plan.videos },
    });
  } catch (err) {
    console.error('video-plan failed:', err instanceof Error ? err.message : 'unknown');
    if (refund) await refund().catch(() => undefined);
    return fail('UNAVAILABLE', 'Something went wrong. Please try again.', 500);
  }
});
