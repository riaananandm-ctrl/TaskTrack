export const SITE_URL = 'https://tasktrackbm.vercel.app';

/** TaskTrack's official profiles. Also listed as sameAs so search engines link them to the site. */
export const SOCIAL_LINKS = [
  { name: 'Instagram', handle: '@task.track', url: 'https://www.instagram.com/task.track/' },
  { name: 'YouTube', handle: '@tasktrackapp', url: 'https://www.youtube.com/@tasktrackapp' },
] as const;

export const ORGANIZATION_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'TaskTrack',
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/assets/images/logo-512.png`,
  sameAs: SOCIAL_LINKS.map((s) => s.url),
};

/** JSON-LD for a <script> tag, with "<" escaped so text can never close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Public pages for search, with the date their content last really changed. */
export const PUBLIC_PAGES: { path: string; updated: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' }[] = [
  { path: '/', updated: '2026-11-27', priority: 1, changeFrequency: 'weekly' },
  { path: '/ib-study-planner', updated: '2026-11-27', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/managebac-planner', updated: '2026-11-27', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/ib-cas-tracker', updated: '2026-11-27', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/signup', updated: '2026-11-25', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/login', updated: '2026-11-20', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/contact', updated: '2026-11-20', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/privacy', updated: '2026-11-17', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/terms', updated: '2026-11-20', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/refund-policy', updated: '2026-11-20', priority: 0.3, changeFrequency: 'yearly' },
];
