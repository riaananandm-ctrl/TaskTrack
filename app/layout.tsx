import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-provider';
import { FontProvider } from '@/lib/font-provider';
import { RecoveryLinkGuard } from '@/components/recovery-link-guard';
import { LastRouteResume } from '@/components/last-route-resume';
import { FONT_VARIABLE_CLASSES } from '@/lib/fonts';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ErrorReporter } from '@/components/error-reporter';

const DESCRIPTION =
  'The free study planner for IB students: sync your ManageBac deadlines, study with AI quizzes and flashcards, check drafts against the IB criteria, and revise with friends.';

export const metadata: Metadata = {
  title: 'TaskTrack — Know What\u2019s Next.',
  metadataBase: new URL('https://tasktrackbm.vercel.app'),
  description: DESCRIPTION,
  manifest: '/manifest.json',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    viewportFit: 'cover',
  },
  themeColor: '#172554',
  icons: {
    icon: '/assets/images/logo-192.png',
    apple: '/assets/images/logo-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'TaskTrack',
  },
  openGraph: {
    title: 'TaskTrack — Know What\u2019s Next.',
    description: DESCRIPTION,
    type: 'website',
    url: '/',
    siteName: 'TaskTrack',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TaskTrack — Know What\u2019s Next.',
    description: DESCRIPTION,
  },
};

/**
 * Runs before the page paints so the saved theme is applied with no flash of the
 * wrong colours. Kept tiny and dependency-free.
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('tasktrack-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={FONT_VARIABLE_CLASSES}>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <AuthProvider>
          <RecoveryLinkGuard />
          <LastRouteResume />
          <ThemeProvider>
            <FontProvider>{children}</FontProvider>
          </ThemeProvider>
        </AuthProvider>
        <ErrorReporter />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
