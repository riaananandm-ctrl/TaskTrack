import Link from 'next/link';
import { ArrowRight, Instagram, Youtube } from 'lucide-react';
import { Logo } from '@/components/logo';
import { ORGANIZATION_LD, SITE_URL, SOCIAL_LINKS, jsonLd } from '@/lib/seo';

export interface FeatureSection {
  title: string;
  body: React.ReactNode;
}

const RELATED = [
  { href: '/ib-study-planner', label: 'IB study planner' },
  { href: '/managebac-planner', label: 'ManageBac planner' },
  { href: '/ib-cas-tracker', label: 'IB CAS tracker' },
];

/** A public, indexable page about one part of TaskTrack. Server-rendered. */
export function FeaturePage({
  path,
  eyebrow,
  title,
  intro,
  sections,
  faqs,
}: {
  path: string;
  eyebrow: string;
  title: string;
  intro: string;
  sections: FeatureSection[];
  faqs: { q: string; a: string }[];
}) {
  const structured = [
    ORGANIZATION_LD,
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description: intro,
      url: `${SITE_URL}${path}`,
      isPartOf: { '@type': 'WebSite', name: 'TaskTrack', url: `${SITE_URL}/` },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'TaskTrack', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: eyebrow, item: `${SITE_URL}${path}` },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ];

  return (
    <div className="min-h-screen bg-[#F6F5F1] text-slate-800 [font-family:var(--font-inter),ui-sans-serif,system-ui,sans-serif]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <header className="bg-[#243B64]">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="TaskTrack home" className="flex items-center gap-2.5">
            <Logo size={34} />
            <span className="text-lg font-bold tracking-tight text-white">TaskTrack</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/login" className="text-blue-100 hover:text-white">Log in</Link>
            <Link href="/signup" className="rounded-md bg-[#315EDB] px-3 py-1.5 font-medium text-white hover:bg-[#274DBE]">Get started</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="bg-[#1F3459] pb-16 pt-12 lg:pb-20 lg:pt-16">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <nav aria-label="Breadcrumb" className="text-sm text-blue-200">
              <Link href="/" className="hover:text-white">TaskTrack</Link> <span aria-hidden>/</span> {eyebrow}
            </nav>
            <h1 className="mt-4 max-w-3xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl">{title}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-blue-100">{intro}</p>
            <Link href="/signup" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[#315EDB] px-5 py-3 text-base font-medium text-white hover:bg-[#274DBE]">
              Start free with TaskTrack <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <div className="mx-auto max-w-3xl space-y-12 px-4 py-16 sm:px-6">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-2xl font-semibold tracking-tight text-[#243B64]">{s.title}</h2>
              <div className="mt-3 space-y-3 leading-7 text-slate-700 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">{s.body}</div>
            </section>
          ))}

          <section>
            <h2 className="text-2xl font-semibold tracking-tight text-[#243B64]">Questions</h2>
            <div className="mt-4 space-y-3">
              {faqs.map((f) => (
                <details key={f.q} className="rounded-xl border border-slate-200 bg-white p-5">
                  <summary className="cursor-pointer font-semibold text-[#243B64]">{f.q}</summary>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-[#243B64] p-8 text-center">
            <p className="text-2xl font-semibold text-white">Free for every student.</p>
            <Link href="/signup" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#315EDB] px-5 py-3 font-medium text-white hover:bg-[#274DBE]">
              Create your TaskTrack account <ArrowRight className="h-4 w-4" />
            </Link>
          </section>

          <nav aria-label="More about TaskTrack" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link href="/" className="text-[#315EDB] hover:underline">TaskTrack home</Link>
            {RELATED.filter((r) => r.href !== path).map((r) => (
              <Link key={r.href} href={r.href} className="text-[#315EDB] hover:underline">{r.label}</Link>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Follow TaskTrack:</span>
            {SOCIAL_LINKS.map((s) => {
              const Icon = s.name === 'Instagram' ? Instagram : Youtube;
              return (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer me"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-[#243B64] hover:border-[#315EDB] hover:text-[#315EDB]">
                  <Icon className="h-4 w-4" aria-hidden /> {s.handle}
                </a>
              );
            })}
          </div>

          <p className="border-l-2 border-slate-300 pl-4 text-xs leading-5 text-slate-500">
            TaskTrack is an independent student project. It is not affiliated with, endorsed by or connected to the
            International Baccalaureate Organization (IB) or Faria Education Group (ManageBac). “IB” and “International
            Baccalaureate” are trademarks of the International Baccalaureate Organization; “ManageBac” is a trademark of
            Faria Education Group.
          </p>
        </div>
      </main>
    </div>
  );
}
