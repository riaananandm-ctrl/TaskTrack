'use client';

import { useRef, type ReactNode, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * A soft glow that follows the pointer across a dark panel. Pure CSS variables, no
 * re-renders. Hidden for touch input and for people who prefer reduced motion.
 */
export function Spotlight({
  children,
  className,
  color = 'rgba(95, 211, 192, 0.18)',
  size = 520,
}: {
  children: ReactNode;
  className?: string;
  color?: string;
  size?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--spot-x', `${e.clientX - r.left}px`);
    ref.current.style.setProperty('--spot-y', `${e.clientY - r.top}px`);
    ref.current.style.setProperty('--spot-o', '1');
  };
  const onLeave = () => ref.current?.style.setProperty('--spot-o', '0');
  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={cn('relative', className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-500 motion-reduce:hidden"
        style={{
          opacity: 'var(--spot-o, 0)',
          background: `radial-gradient(${size}px circle at var(--spot-x, 50%) var(--spot-y, 50%), ${color}, transparent 60%)`,
        }}
      />
      {children}
    </div>
  );
}
