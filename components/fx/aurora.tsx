/**
 * Slowly drifting colour blobs for dark brand panels. Decorative only; the motion
 * stops for people who prefer reduced motion (see .aurora-blob in globals.css).
 */
export function Aurora({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div className="aurora-blob aurora-1" />
      <div className="aurora-blob aurora-2" />
      <div className="aurora-blob aurora-3" />
    </div>
  );
}
