import { Logo } from '@/components/logo';
import Link from 'next/link';
import { ReactNode } from 'react';
import { Aurora } from '@/components/fx/aurora';
import { Spotlight } from '@/components/fx/spotlight';
import { Tilt } from '@/components/fx/tilt';

/** Illustrative cards floating on the brand panel (sample content, not real data). */
function FloatingCards() {
  return (
    <div className="relative mx-auto h-[260px] w-full max-w-md" aria-hidden>
      <div className="absolute left-0 top-2 w-[78%] animate-float">
        <Tilt className="rounded-2xl" max={8}>
          <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md shadow-xl shadow-black/20">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-200">Due tomorrow</p>
              <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-200">Summative</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-white">Chemistry: bonding test</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-sky-300 to-[#5FD3C0]" />
            </div>
            <p className="mt-1.5 text-[11px] text-blue-200">2 of 3 study sessions done</p>
          </div>
        </Tilt>
      </div>
      <div className="absolute bottom-0 right-0 w-[70%] animate-float-slow">
        <Tilt className="rounded-2xl" max={8}>
          <div className="rounded-2xl border border-white/15 bg-[#0f1d3d]/70 p-4 backdrop-blur-md shadow-xl shadow-black/30">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5FD3C0]/20 text-[#5FD3C0]">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
              </span>
              <div>
                <p className="text-sm font-semibold text-white">Spanish: writing task</p>
                <p className="text-[11px] text-blue-200">Completed · +20 XP</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <span key={d} className={`h-2 flex-1 rounded-full ${d <= 5 ? 'bg-[#5FD3C0]' : 'bg-white/15'}`} />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-blue-200">5-day streak</p>
          </div>
        </Tilt>
      </div>
    </div>
  );
}

export function AuthLayout({
  children,
  title,
  subtitle,
  footer,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Brand panel (desktop) */}
      <Spotlight className="hidden lg:flex lg:w-1/2 overflow-hidden bg-[#1F3459]">
        <Aurora />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          aria-hidden
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div className="relative flex flex-col justify-between gap-10 p-12 text-white w-full">
          <Link href="/" className="inline-flex items-center gap-3 self-start">
            <Logo size={40} className="shadow-lg shadow-black/20" />
            <span className="text-xl font-bold tracking-tight">TaskTrack</span>
          </Link>
          <div className="space-y-8">
            <div className="space-y-4">
              <h2 className="text-5xl font-bold leading-[1.08] tracking-tight">
                Know what&rsquo;s due.
                <br />
                <span className="text-shimmer">Be ready for it.</span>
              </h2>
              <p className="text-lg text-blue-200 leading-relaxed max-w-md">
                Your ManageBac and Classroom deadlines, sorted by subject, with AI study help for each one.
              </p>
            </div>
            <FloatingCards />
          </div>
          <p className="text-xs text-blue-300">
            &copy; {new Date().getFullYear()} TaskTrack. All rights reserved.
          </p>
        </div>
      </Spotlight>

      {/* Brand strip (mobile and tablet) */}
      <div className="relative overflow-hidden bg-[#1F3459] px-6 pb-10 pt-6 text-white lg:hidden">
        <Aurora />
        <div className="relative">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Logo size={34} />
            <span className="text-lg font-bold tracking-tight">TaskTrack</span>
          </Link>
          <p className="mt-5 text-2xl font-bold leading-tight tracking-tight">
            Know what&rsquo;s due. <span className="text-shimmer">Be ready for it.</span>
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex-1 flex items-start lg:items-center justify-center p-6 sm:p-12 bg-background app-backdrop -mt-6 rounded-t-3xl lg:mt-0 lg:rounded-none">
        <div className="w-full max-w-md animate-slide-up">
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          </div>
          {children}
          {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
