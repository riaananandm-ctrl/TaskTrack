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
      <div className="hidden lg:flex lg:w-1/2 gradient-navy relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 bg-sky-400 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-80 h-80 bg-blue-500 rounded-full blur-3xl" />
        </div>
        <div className="relative flex flex-col justify-between p-12 text-white w-full">
          <Link href="/">
            <div className="inline-flex items-center justify-center rounded-xl bg-white p-2 shadow-soft">
              <Logo size={28} showText={false} />
            </div>
          </Link>
          <div className="space-y-6">
            <h2 className="text-4xl font-bold leading-tight">
              Know What&rsquo;s Next.
            </h2>
            <p className="text-lg text-blue-200 leading-relaxed max-w-md">
              Keep all your academic tasks, deadlines and reminders in one organised place.
            </p>
            <div className="space-y-3 pt-4">
              {['Organise tasks by subject', 'Set reminders for exact times', 'Plan your week with confidence'].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-sky-400/20 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-sky-400" />
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
            <Link href="/">
              <Logo />
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
