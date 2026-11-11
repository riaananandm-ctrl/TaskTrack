import { cn } from '@/lib/utils';

const LOGO_SRC = '/assets/images/1.png';

interface LogoProps {
  className?: string;
  /** Height of the logo in pixels. The wordmark scales proportionally. */
  size?: number;
  /**
   * Kept for API compatibility. The current logo is a full-colour circular badge with
   * its own light background, so it reads on light and dark surfaces without recolouring.
   */
  tone?: 'auto' | 'light' | 'dark';
  /** Kept for API compatibility. The wordmark is part of the logo image. */
  showText?: boolean;
  /** Kept for API compatibility. The wordmark is part of the logo image. */
  textClassName?: string;
}

export function Logo({ className, size = 32 }: LogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- images are unoptimized in next.config; a plain img avoids layout wrappers
    <img
      src={LOGO_SRC}
      alt="TaskTrack"
      // rounded-full clips the square image to its circular badge, so no square corners
      // show on the navy header and sidebar.
      className={cn('block h-auto w-auto object-contain flex-shrink-0 rounded-full', className)}
      style={{ height: size, maxWidth: 'none' }}
    />
  );
}
