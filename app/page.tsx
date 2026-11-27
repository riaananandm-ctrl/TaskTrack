import type { Metadata } from 'next';
import { HomePage } from '@/components/landing/home-page';
import { LANDING_FAQS } from '@/lib/landing-faq';
import { ORGANIZATION_LD, SITE_URL, jsonLd } from '@/lib/seo';

export const metadata: Metadata = {
  title: { absolute: 'TaskTrack — Free IB Study Planner with ManageBac Sync' },
  alternates: { canonical: '/' },
};

const STRUCTURED_DATA = [
  ORGANIZATION_LD,
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'TaskTrack',
    alternateName: ['Task Track', 'TaskTrack IB planner'],
    url: `${SITE_URL}/`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'TaskTrack',
    url: `${SITE_URL}/`,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web, Android, iOS',
    description:
      'The free study planner for IB students: sync ManageBac and Google Classroom deadlines, study with AI quizzes and flashcards, check drafts against the IB criteria, and track CAS.',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
    audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: LANDING_FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  },
];

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(STRUCTURED_DATA) }} />
      <HomePage />
    </>
  );
}
