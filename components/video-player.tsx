'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ExternalLink, Loader2, PlayCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { embedUrl, findVideo, type VideoLookup } from '@/lib/videos';
import { youtubeSearchUrl } from '@/lib/study-modes';

interface Request { search: string; label: string }
// Outside a provider, fall back to a YouTube search in a new tab.
const PlayerContext = createContext<(r: Request) => void>((r) => {
  window.open(youtubeSearchUrl({ title: '', channel: '', search: r.search }), '_blank', 'noopener,noreferrer');
});

/** Wrap a page so any "Watch" button can open the in-app player. */
export function VideoPlayerProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const [result, setResult] = useState<VideoLookup | null>(null);

  const open = useCallback((r: Request) => {
    setReq(r);
    setResult(null);
    findVideo(r.search).then(setResult);
  }, []);

  const searchUrl = req ? youtubeSearchUrl({ title: '', channel: '', search: req.search }) : '#';

  return (
    <PlayerContext.Provider value={open}>
      {children}
      <Dialog open={Boolean(req)} onOpenChange={(o) => !o && setReq(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0">
          <DialogHeader className="px-5 pt-4 pb-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <PlayCircle className="h-5 w-5 text-red-600" aria-hidden />
              <span className="line-clamp-1">{result?.ok ? result.title : req?.label}</span>
            </DialogTitle>
            <DialogDescription>
              {result?.ok ? `${result.channel} · educational video, watch it right here` : 'Finding an educational video…'}
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
                key={result.videoId}
                src={embedUrl(result.videoId)}
                title={result.title || 'Educational video'}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}
            {result && !result.ok && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
                <p className="text-sm">
                  {result.reason === 'not_found'
                    ? 'Couldn’t find a suitable educational video for this one.'
                    : result.reason === 'rate_limited'
                      ? 'You’ve watched a lot today! In-app videos are back tomorrow.'
                      : 'In-app videos aren’t available right now.'}
                </p>
                <a href={searchUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold hover:bg-red-700">
                  Search YouTube instead <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
          {result?.ok && (
            <div className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs text-muted-foreground">
              <span>Only safe-search educational videos are shown here.</span>
              <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                More on YouTube <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PlayerContext.Provider>
  );
}

export function useVideoPlayer() {
  return useContext(PlayerContext);
}
