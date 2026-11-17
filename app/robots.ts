import type { MetadataRoute } from 'next';

const SITE = 'https://tasktrackbm.vercel.app';

/** Lets search engines index the public pages, but not students' own planner pages. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app/', '/api/', '/auth/', '/onboarding', '/starter', '/parent-consent', '/reset-password'],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
