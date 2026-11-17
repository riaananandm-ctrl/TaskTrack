import type { Metadata } from 'next';

/** The summary link carries a private token, so keep it out of search engines and referrer headers. */
export const metadata: Metadata = {
  title: 'Weekly summary · TaskTrack',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ParentSummaryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
