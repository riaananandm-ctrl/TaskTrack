import {
  Plus_Jakarta_Sans,
  Inter,
  DM_Sans,
  Nunito_Sans,
  Atkinson_Hyperlegible,
} from 'next/font/google';

/**
 * Curated, highly readable fonts. Each is loaded through next/font so it is
 * self-hosted with a system-font fallback — if a font ever fails to load, the
 * app still renders in a safe fallback rather than breaking.
 */
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plus-jakarta-sans',
  // Only the default font (Inter) is preloaded; the rest load when chosen in Settings.
  preload: false,
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-sans',
  // Only the default font (Inter) is preloaded; the rest load when chosen in Settings.
  preload: false,
});

const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-nunito-sans',
  // Only the default font (Inter) is preloaded; the rest load when chosen in Settings.
  preload: false,
});

const atkinsonHyperlegible = Atkinson_Hyperlegible({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-atkinson-hyperlegible',
  // Only the default font (Inter) is preloaded; the rest load when chosen in Settings.
  preload: false,
});

export interface FontOption {
  id: string;
  label: string;
  description: string;
  variable: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'inter',
    label: 'Inter',
    description: 'The TaskTrack default — neutral and highly legible on screens.',
    variable: inter.variable,
  },
  {
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    description: 'Geometric and friendly.',
    variable: plusJakartaSans.variable,
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    description: 'Rounded and calm, easy on long reading.',
    variable: dmSans.variable,
  },
  {
    id: 'nunito-sans',
    label: 'Nunito Sans',
    description: 'Soft, warm and approachable.',
    variable: nunitoSans.variable,
  },
  {
    id: 'atkinson-hyperlegible',
    label: 'Atkinson Hyperlegible',
    description: 'Designed for maximum clarity and low vision.',
    variable: atkinsonHyperlegible.variable,
  },
];

export const DEFAULT_FONT_ID = 'inter';

/** All font CSS-variable class names, applied once on the <html> element. */
export const FONT_VARIABLE_CLASSES = FONT_OPTIONS.map((f) => f.variable).join(' ');

export function isFontId(value: unknown): value is string {
  return typeof value === 'string' && FONT_OPTIONS.some((f) => f.id === value);
}
