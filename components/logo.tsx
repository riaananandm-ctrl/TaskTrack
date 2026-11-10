import { cn } from '@/lib/utils';

const LOGO_SRC = '/assets/images/1.png';

interface LogoProps {
  className?: string;
  /** Height of the logo in pixels. The wordmark scales proportionally. */
  size?: number;
  /** Kept for API compatibility. The wordmark is part of the logo image. */
  showText?: boolean;
  /** Kept for API compatibility. The wordmark is part of the logo image. */
  textClassName?: string;
}

export function Logo({ className, size = 32, showText, textClassName }: LogoProps) {
  return (
    <img
      src={LOGO_SRC}
      alt="TaskTrack"
      className={cn('block h-auto w-auto object-contain flex-shrink-0', className)}
      style={{ height: size, maxWidth: 'none' }}
    />
  );
}
