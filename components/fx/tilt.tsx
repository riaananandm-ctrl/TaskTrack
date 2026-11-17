'use client';

import { useRef, type ReactNode, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tilts its content a few degrees toward the pointer, with a soft glare. Mouse and
 * pen only; disabled for touch and for people who prefer reduced motion.
 */
export function Tilt({ children, className, max = 6 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType === 'touch' || reduced()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1000px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg)`;
    el.style.setProperty('--glare-x', `${(px + 0.5) * 100}%`);
    el.style.setProperty('--glare-y', `${(py + 0.5) * 100}%`);
    el.style.setProperty('--glare-o', '1');
  };
  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    el.style.setProperty('--glare-o', '0');
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={cn('relative transition-transform duration-300 ease-out will-change-transform [transform-style:preserve-3d]', className)}
    >
      {children}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
        style={{
          opacity: 'var(--glare-o, 0)',
          background: 'radial-gradient(400px circle at var(--glare-x, 50%) var(--glare-y, 50%), rgba(255,255,255,0.18), transparent 55%)',
        }}
      />
    </div>
  );
}
