'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, PlayCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { embedUrl, findVideo, type VideoLookup } from '@/lib/videos';
import { youtubeSearchUrl, type PlaylistVideo } from '@/lib/study-modes';
import { setVideoWatched, useWatchedVideos, videoKey } from '@/lib/video-progress';
import { cn } from '@/lib/utils';

/**
 * A single video ({ search, label }) or a playlist ({ search, label, playlist, index })
 * where the player shows "Video 2 of 8", Previous / Next, and moves on to the next
 * video by itself when one finishes.
 */
export interface VideoRequest extends PlaylistVideo {
  playlist?: PlaylistVideo[];
  index?: number;
}

// Outside a provider, fall back to a YouTube search in a new tab.
const PlayerContext = createContext<(r: VideoRequest) => void>((r) => {
  window.open(youtubeSearchUrl({ title: '', channel: '', search: r.search }), '_blank', 'noopener,noreferrer');
});

const AUTO_NEXT_SECONDS = 5;

/** Wrap a page so any "Watch" button can open the in-app player. */
export function VideoPlayerProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<PlaylistVideo[] | null>(null);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<VideoLookup | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const watched = useWatchedVideos();

  const current = list?.[index] ?? null;
  const total = list?.length ?? 0;
  const hasNext = index < total - 1;

  const open = useCallback((r: VideoRequest) => {
    const items = r.playlist && r.playlist.length > 0 ? r.playlist : [{ search: r.search, label: r.label }];
    const start = Math.min(Math.max(r.index ?? 0, 0), items.length - 1);
    setList(items);
    setIndex(start);
  }, []);

  // Look up the video for whichever item is showing.
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setResult(null);
    setCountdown(null);
    findVideo(current.search).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [current]);

  const goTo = useCallback(
    (next: number) => {
      if (!list || next < 0 || next >= list.length) return;
      setIndex(next);
    },
    [list]
  );

  const finishCurrent = useCallback(() => {
    if (current) setVideoWatched(current.search, true);
  }, [current]);

  // Hear from the YouTube player when the video ends.
  useEffect(() => {
    if (!result?.ok) return;
    const onMessage = (e: MessageEvent) => {
      if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      let data: { event?: string; info?: unknown } | null = null;
      try {
        data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const state =
        data?.event === 'onStateChange'
          ? data.info
          : data?.event === 'infoDelivery' && data.info && typeof data.info === 'object'
            ? (data.info as { playerState?: unknown }).playerState
            : undefined;
      if (state === 0) {
        finishCurrent();
        if (hasNext) setCountdown(AUTO_NEXT_SECONDS);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [result, hasNext, finishCurrent]);

  // "Up next in 5…" then move on, unless the student cancels.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      goTo(index + 1);
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, goTo, index]);

  const listen = () => {
    // Ask the YouTube player to send its state changes to this page.
    const send = () =>
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
    send();
    window.setTimeout(send, 1000);
  };

  const close = () => {
    setList(null);
    setResult(null);
    setCountdown(null);
  };

  const searchUrl = current ? youtubeSearchUrl({ title: '', channel: '', search: current.search }) : '#';
  const isWatched = current ? watched.has(videoKey(current.search)) : false;
  const nextItem = hasNext && list ? list[index + 1] : null;

  return (
    <PlayerContext.Provider value={open}>
      {children}
      <Dialog open={Boolean(list)} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0">
          <DialogHeader className="px-5 pt-4 pb-3 pr-12">
            {total > 1 && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">
                Video {index + 1} of {total}
              </p>
            )}
            <DialogTitle className="flex items-center gap-2 text-base">
              <PlayCircle className="h-5 w-5 shrink-0 text-red-600" aria-hidden />
              <span className="line-clamp-1">{result?.ok ? result.title : current?.label}</span>
            </DialogTitle>
            <DialogDescription className="line-clamp-1">
              {result?.ok
                ? `${result.channel} · ${total > 1 ? current?.label : 'educational video, watch it right here'}`
                : result
                  ? total > 1 ? current?.label : 'Educational video'
                  : 'Finding an educational video…'}
            </DialogDescription>
          </DialogHeader>

          <div className="relative aspect-video w-full bg-black">
            {!result && (
              <div className="absolute inset-0 flex items-center justify-center text-white/80">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
            {result?.ok && (
              <iframe
                ref={iframeRef}
                key={result.videoId}
                src={embedUrl(result.videoId, typeof window !== 'undefined' ? window.location.origin : undefined)}
                title={result.title || 'Educational video'}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={listen}
              />
            )}
            {result && !result.ok && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
                <p className="text-sm">
                  {result.reason === 'not_found'
                    ? 'Couldn’t find a suitable educational video for this one.'
                    : result.reason === 'rate_limited'
                      ? 'You’ve watched a lot today! In-app videos are back tomorrow.'
                      : 'In-app videos aren’t switched on yet.'}
                </p>
                <a href={searchUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold hover:bg-red-700">
                  Search YouTube instead <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
            {countdown !== null && nextItem && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center text-white">
                <p className="text-xs uppercase tracking-wide text-white/70">Up next in {countdown}</p>
                <p className="max-w-md text-base font-semibold">Video {index + 2}: {nextItem.label}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCountdown(null)}
                    className="rounded-lg border border-white/30 px-3.5 py-2 text-sm font-medium hover:bg-white/10">
                    Stay here
                  </button>
                  <button type="button" onClick={() => { setCountdown(null); goTo(index + 1); }}
                    className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold hover:bg-red-700">
                    Play now
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              {total > 1 && (
                <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40">
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </button>
              )}
              {current && (
                <button type="button" onClick={() => setVideoWatched(current.search, !isWatched)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium',
                    isWatched ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'hover:bg-muted'
                  )}>
                  <Check className="h-3.5 w-3.5" /> {isWatched ? 'Watched' : 'Mark watched'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <a href={searchUrl} target="_blank" rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
                More on YouTube <ExternalLink className="h-3 w-3" />
              </a>
              {hasNext && (
                <button type="button" onClick={() => { finishCurrent(); goTo(index + 1); }}
                  className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                  Next video <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
              {total > 1 && !hasNext && (
                <button type="button" onClick={() => { finishCurrent(); close(); }}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                  <Check className="h-3.5 w-3.5" /> Finish plan
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PlayerContext.Provider>
  );
}

export function useVideoPlayer() {
  return useContext(PlayerContext);
}
