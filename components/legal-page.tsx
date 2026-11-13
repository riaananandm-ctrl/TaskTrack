import Link from 'next/link';
import { Logo } from '@/components/logo';

/** Shared frame for the Privacy Policy and Terms of Service. */
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen gradient-navy text-slate-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="TaskTrack home">
            <Logo size={34} tone="light" />
          </Link>
          <Link href="/" className="text-sm text-slate-300 hover:text-white">
            Back to home
          </Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-24">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">TaskTrack</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-4 text-sm text-slate-400">Last updated {updated}</p>
        <div className="mt-6 leading-7 text-slate-300">{intro}</div>
        <div className="legal mt-12 space-y-10 text-slate-300">{children}</div>
        <p className="mt-14 border-l-2 border-sky-400/60 pl-4 text-sm leading-6 text-slate-400">
          TaskTrack is an independent student project. It is not affiliated with, endorsed by or connected to the
          International Baccalaureate Organization (IB) or Faria Education Group (ManageBac). “IB” and “International
          Baccalaureate” are trademarks of the International Baccalaureate Organization; “ManageBac” is a trademark of
          Faria Education Group.
        </p>
      </article>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-3 leading-7 [&_a]:text-sky-300 [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}

export const CONTACT = (
  <>
    the TaskTrack team at <a href="mailto:riaananandm@sis.edu.in">riaananandm@sis.edu.in</a>,{' '}
    <a href="mailto:vayung@sis.edu.in">vayung@sis.edu.in</a> or <a href="mailto:nagasaim@sis.edu.in">nagasaim@sis.edu.in</a>
  </>
);
