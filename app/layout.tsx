import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-provider';
import { FontProvider } from '@/lib/font-provider';
import { RecoveryLinkGuard } from '@/components/recovery-link-guard';
import { LastRouteResume } from '@/components/last-route-resume';
import { FONT_VARIABLE_CLASSES } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'TaskTrack — Know What\u2019s Next.',
  description:
    'TaskTrack keeps your academic tasks, deadlines and reminders in one organised place.',
  manifest: '/manifest.json',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    viewportFit: 'cover',
  },
  themeColor: '#172554',
  icons: {
    icon: '/assets/images/Screenshot_2026-09-28_at_9.58.09_AM-removebg-preview.png',
    apple: '/assets/images/Screenshot_2026-09-28_at_9.58.09_AM-removebg-preview.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'TaskTrack',
  },
  openGraph: {
    title: 'TaskTrack — Know What\u2019s Next.',
    description:
      'TaskTrack keeps your academic tasks, deadlines and reminders in one organised place.',
    type: 'website',
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
      </body>
    </html>
  );
}
