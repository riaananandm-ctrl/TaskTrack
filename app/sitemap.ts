import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES, SITE_URL } from '@/lib/seo';

/** The public pages Google should know about, with real "last changed" dates. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((p) => ({
    url: `${SITE_URL}${p.path}`,
    lastModified: new Date(`${p.updated}T00:00:00+05:30`),
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
