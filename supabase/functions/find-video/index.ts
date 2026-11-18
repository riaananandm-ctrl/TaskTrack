import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Finds ONE educational YouTube video for a search, so it can play inside TaskTrack.
 *
 * Only videos that are embeddable, pass YouTube's strict safe search, and sit in the
 * Education (27) or Science & Technology (28) categories are returned. Results are
 * cached in video_lookup_cache. Needs the YOUTUBE_API_KEY secret; without it the app
 * falls back to opening a YouTube search in a new tab.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const EDUCATIONAL_CATEGORIES = new Set(['27', '28']);
const CACHE_DAYS = 30;
const DAILY_LOOKUPS_PER_USER = 40;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ ok: false, error: 'not_configured' }, 500);

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ ok: false, error: 'auth' }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let search = '';
  try {
    const body = await req.json();
    search = typeof body?.search === 'string' ? body.search : '';
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const query = search.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);
  if (query.length < 2) return json({ ok: false, error: 'invalid_request' }, 400);

  // Cached answer (including "nothing suitable") for 30 days.
  const { data: cached } = await admin
    .from('video_lookup_cache')
    .select('video_id, title, channel, fetched_at')
    .eq('query', query)
    .maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_DAYS * 86_400_000) {
    return cached.video_id
      ? json({ ok: true, videoId: cached.video_id, title: cached.title, channel: cached.channel })
      : json({ ok: false, error: 'not_found' });
  }

  const key = Deno.env.get('YOUTUBE_API_KEY');
  if (!key) return json({ ok: false, error: 'not_configured' });

  // A fair share of the shared daily quota per student.
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin
    .from('app_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userData.user.id)
    .eq('event_name', 'video_lookup')
    .gte('created_at', since);
  if ((count ?? 0) >= DAILY_LOOKUPS_PER_USER) return json({ ok: false, error: 'rate_limited' });
  await admin.from('app_metrics').insert({ user_id: userData.user.id, event_name: 'video_lookup', event_data: {} });

  try {
    const s = new URL('https://www.googleapis.com/youtube/v3/search');
    s.search = new URLSearchParams({
      part: 'snippet', q: query, type: 'video', maxResults: '8',
      videoEmbeddable: 'true', videoSyndicated: 'true', safeSearch: 'strict', relevanceLanguage: 'en', key,
    }).toString();
    const sr = await fetch(s);
    if (!sr.ok) {
      console.error('YouTube search failed', sr.status, (await sr.text()).slice(0, 200));
      return json({ ok: false, error: 'upstream' });
    }
    const sd = await sr.json();
    const ids: string[] = (sd.items ?? []).map((i: { id?: { videoId?: string } }) => i.id?.videoId).filter(Boolean);
    let pick: { id: string; title: string; channel: string } | null = null;
    if (ids.length) {
      const v = new URL('https://www.googleapis.com/youtube/v3/videos');
      v.search = new URLSearchParams({ part: 'snippet,status,contentDetails', id: ids.join(','), key }).toString();
      const vr = await fetch(v);
      if (vr.ok) {
        const vd = await vr.json();
        const byId = new Map<string, Record<string, any>>((vd.items ?? []).map((i: Record<string, any>) => [i.id, i]));
        for (const id of ids) {
          const it = byId.get(id);
          if (!it) continue;
          const ok = it.status?.embeddable === true
            && it.status?.privacyStatus === 'public'
            && EDUCATIONAL_CATEGORIES.has(String(it.snippet?.categoryId))
            && it.contentDetails?.contentRating?.ytRating !== 'ytAgeRestricted'
            && it.snippet?.liveBroadcastContent === 'none';
          if (ok) {
            pick = { id, title: String(it.snippet?.title ?? '').slice(0, 200), channel: String(it.snippet?.channelTitle ?? '').slice(0, 100) };
            break;
          }
        }
      }
    }
    await admin.from('video_lookup_cache').upsert({
      query, video_id: pick?.id ?? null, title: pick?.title ?? null, channel: pick?.channel ?? null, fetched_at: new Date().toISOString(),
    });
    return pick
      ? json({ ok: true, videoId: pick.id, title: pick.title, channel: pick.channel })
      : json({ ok: false, error: 'not_found' });
  } catch (e) {
    console.error('find-video failed', e instanceof Error ? e.message : 'unknown');
    return json({ ok: false, error: 'upstream' });
  }
});
