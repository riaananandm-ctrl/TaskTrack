'use client';

import { supabase } from '@/lib/supabase/client';

export type VideoLookup =
  | { ok: true; videoId: string; title: string; channel: string }
  | { ok: false; reason: 'not_configured' | 'not_found' | 'rate_limited' | 'error' };

const memo = new Map<string, VideoLookup>();

/** One embeddable, educational YouTube video for a search, chosen on the server. */
export async function findVideo(search: string): Promise<VideoLookup> {
  const key = search.trim().toLowerCase();
  const hit = memo.get(key);
  if (hit) return hit;
  try {
    const { data, error } = await supabase.functions.invoke('find-video', { body: { search } });
    if (error || !data) return { ok: false, reason: 'error' };
    const d = data as { ok?: boolean; videoId?: string; title?: string; channel?: string; error?: string };
    let out: VideoLookup;
    if (d.ok && d.videoId && /^[A-Za-z0-9_-]{11}$/.test(d.videoId)) {
      out = { ok: true, videoId: d.videoId, title: d.title ?? '', channel: d.channel ?? '' };
    } else {
      const r = d.error;
      out = { ok: false, reason: r === 'not_configured' || r === 'not_found' || r === 'rate_limited' ? r : 'error' };
    }
    if (out.ok || out.reason === 'not_found') memo.set(key, out);
    return out;
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Privacy-enhanced embed: no tracking cookies until play, related videos limited to the same channel. */
export function embedUrl(videoId: string, origin?: string): string {
  // enablejsapi lets the page hear when the video ends, to move on to the next one.
  const o = origin ? `&origin=${encodeURIComponent(origin)}` : '';
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1${o}`;
}
