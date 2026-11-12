import { Logo } from '@/components/logo';
import Link from 'next/link';
import { ReactNode } from 'react';

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
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#243B64] relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              'radial-gradient(38rem 28rem at 100% 0%, rgba(49,94,219,0.6), transparent 65%), radial-gradient(34rem 26rem at 0% 105%, rgba(34,178,158,0.32), transparent 65%), linear-gradient(170deg,#243B64 0%,#172648 100%)',
          }}
        />
        <div className="relative flex flex-col justify-between p-12 text-white w-full">
          <Link href="/" className="inline-flex items-center gap-3 self-start">
            <Logo size={40} className="shadow-lg shadow-black/20" />
            <span className="text-xl font-bold tracking-tight">TaskTrack</span>
          </Link>
          <div className="space-y-6">
            <h2 className="text-5xl font-bold leading-[1.08] tracking-tight">
              Know what&rsquo;s due.
              <br />
              <span className="text-[#5FD3C0]">Be ready for it.</span>
            </h2>
            <p className="text-lg text-blue-200 leading-relaxed max-w-md">
              Keep all your academic tasks, deadlines and reminders in one organised place.
            </p>
            <div className="space-y-3 pt-4">
              {['Organise tasks by subject', 'Set reminders for exact times', 'Plan your week with confidence'].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#22B29E]/20 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="#5FD3C0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m5 12.5 4.500 4.500L19 7.500" />
                    </svg>
                  </div>
                  <span className="text-sm text-blue-100">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-blue-300">
            &copy; {new Date().getFullYear()} TaskTrack. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Logo size={34} />
              <span className="text-lg font-bold tracking-tight">TaskTrack</span>
            </Link>
          </div>
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
