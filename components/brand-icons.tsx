import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * TaskTrack's own icon set. Two-tone: a soft back shape plus a foreground in the logo's
 * blue → teal → green gradient, so the icons read as part of the brand on light and
 * dark surfaces. All are drawn on a 24×24 grid with rounded joins.
 */

interface IconProps {
  className?: string;
  /** Rendered size in pixels. */
  size?: number;
}

const BRAND = ['#3B6FF0', '#14B8A6', '#62CC6A'] as const;
const WARM = ['#FF8A3D', '#F0543B', '#E0356F'] as const;

function Svg({
  size = 28,
  className,
  stops = BRAND,
  children,
}: IconProps & { stops?: readonly string[]; children: (fill: string) => React.ReactNode }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={cn('flex-shrink-0', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          {stops.map((c, i) => (
            <stop key={c} offset={i / (stops.length - 1)} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      {children(`url(#${id})`)}
    </svg>
  );
}

/** Level: a lightning bolt over a soft disc. */
export function LevelIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <circle cx="12" cy="12" r="10" fill={g} opacity="0.16" />
          <path
            d="M13.2 3.6 6.4 13.1a.6.6 0 0 0 .5.95h4.2l-.9 5.9a.4.4 0 0 0 .72.3l6.7-9.4a.6.6 0 0 0-.5-.95h-4.1l.9-6a.4.4 0 0 0-.72-.3Z"
            fill={g}
          />
        </>
      )}
    </Svg>
  );
}

/** Streak: a flame with a bright core. Warm gradient so it reads as "on fire". */
export function StreakIcon(props: IconProps) {
  return (
    <Svg {...props} stops={WARM}>
      {(g) => (
        <>
          <path
            d="M12.3 2.3c.4 3 2 4.6 3.5 6.3 1.6 1.8 2.9 3.7 2.9 6.3A6.7 6.7 0 0 1 12 21.7a6.7 6.7 0 0 1-6.7-6.8c0-2.1.9-3.9 2.2-5.1.2 1.300.8 2.200 1.700 2.800-.1-3.800 1-7.600 3.100-10.300Z"
            fill={g}
          />
          <path
            d="M12 12.600c1.700 1.500 2.700 2.900 2.700 4.500a2.700 2.700 0 0 1-5.400 0c0-1.600 1-3 2.700-4.500Z"
            fill="#fff"
            opacity="0.7"
          />
        </>
      )}
    </Svg>
  );
}

/** Badges: a trophy cup. */
export function BadgeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <path
            d="M7 5H4.300a.800.800 0 0 0-.800.800V7a4 4 0 0 0 4 4M17 5h2.700a.800.800 0 0 1 .800.800V7a4 4 0 0 1-4 4"
            stroke={g}
            strokeWidth="1.800"
            strokeLinecap="round"
            opacity="0.45"
          />
          <path d="M7 3.800h10v5.700a5 5 0 0 1-10 0V3.800Z" fill={g} />
          <path d="M12 14.500v3.200M8.500 20.200h7" stroke={g} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

/** Calendar with the logo's check mark inside. */
export function CalendarCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <rect x="3" y="4.500" width="18" height="16.500" rx="4" fill={g} opacity="0.18" />
          <path d="M3 8.500a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v1.300H3V8.500Z" fill={g} />
          <path d="M8 2.800v3M16 2.800v3" stroke={g} strokeWidth="2" strokeLinecap="round" />
          <path d="m8.600 15.200 2.400 2.400 4.600-4.900" stroke={g} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </Svg>
  );
}

/** Due today: a clock face. */
export function DueTodayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <circle cx="12" cy="12" r="9.500" fill={g} opacity="0.18" />
          <circle cx="12" cy="12" r="8.600" stroke={g} strokeWidth="1.800" />
          <path d="M12 7.200V12l3.200 2" stroke={g} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </Svg>
  );
}

/** Next 7 days: a short agenda list. */
export function UpcomingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <rect x="3" y="3.500" width="18" height="17" rx="4" fill={g} opacity="0.18" />
          <circle cx="7.600" cy="8.300" r="1.300" fill={g} />
          <circle cx="7.600" cy="12" r="1.300" fill={g} />
          <circle cx="7.600" cy="15.700" r="1.300" fill={g} />
          <path d="M11.200 8.300h5.600M11.200 12h5.600M11.200 15.700h3.400" stroke={g} strokeWidth="1.900" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

/** Done: a filled circle with the logo's check mark. */
export function DoneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <circle cx="12" cy="12" r="9.500" fill={g} />
          <path d="m7.800 12.300 2.900 2.900 5.600-6" stroke="#fff" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </Svg>
  );
}

/** Study session: an open book. */
export function StudyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <path d="M12 6.300c-1.800-1.300-4.200-1.900-7.200-1.800a.800.800 0 0 0-.800.800v11.600c0 .450.360.800.800.800 2.900-.050 5.300.550 7.200 1.800V6.300Z" fill={g} />
          <path d="M12 6.300c1.800-1.300 4.200-1.900 7.200-1.800.440 0 .800.360.800.800v11.600a.800.800 0 0 1-.800.800c-2.900-.050-5.300.550-7.200 1.800V6.300Z" fill={g} opacity="0.4" />
        </>
      )}
    </Svg>
  );
}

/** Overdue: a rounded warning triangle in red. */
export function OverdueIcon(props: IconProps) {
  return (
    <Svg {...props} stops={['#F87171', '#DC2626']}>
      {(g) => (
        <>
          <path d="M10.300 4.300a2 2 0 0 1 3.400 0l7.300 12.400a2 2 0 0 1-1.700 3H4.700a2 2 0 0 1-1.700-3l7.300-12.400Z" fill={g} opacity="0.2" />
          <path d="M10.300 4.300a2 2 0 0 1 3.400 0l7.300 12.400a2 2 0 0 1-1.700 3H4.700a2 2 0 0 1-1.700-3l7.300-12.400Z" stroke={g} strokeWidth="1.700" strokeLinejoin="round" />
          <path d="M12 9.200v4.300" stroke={g} strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.400" r="1.150" fill={g} />
        </>
      )}
    </Svg>
  );
}

/** Reminders: a bell with a small notification dot. */
export function ReminderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <path
            d="M12 3.2a5.900 5.900 0 0 0-5.900 5.900v3.300c0 .700-.250 1.400-.700 1.950l-1.050 1.300a.800.800 0 0 0 .620 1.300h14.060a.800.800 0 0 0 .620-1.300l-1.050-1.300a3.100 3.100 0 0 1-.700-1.950V9.100A5.900 5.900 0 0 0 12 3.200Z"
            fill={g}
          />
          <path d="M9.700 19.300a2.400 2.400 0 0 0 4.600 0" stroke={g} strokeWidth="1.900" strokeLinecap="round" />
          <circle cx="18" cy="5.600" r="2.400" fill="#62CC6A" stroke="#fff" strokeWidth="1.200" />
        </>
      )}
    </Svg>
  );
}

/** Slides / document: stacked pages. */
export function SlidesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <rect x="6" y="3" width="13" height="16" rx="3" fill={g} opacity="0.3" />
          <rect x="3.500" y="5.500" width="13" height="15.500" rx="3" fill={g} />
          <path d="M7 11h6M7 14.500h4" stroke="#fff" strokeWidth="1.700" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

/** AI Grader: a marked page with a check badge. */
export function GraderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <rect x="4" y="2.800" width="13.500" height="18" rx="3" fill={g} opacity="0.22" />
          <path d="M7.500 8h6.500M7.500 11.500h6.500M7.500 15h3.200" stroke={g} strokeWidth="1.800" strokeLinecap="round" />
          <circle cx="16.800" cy="16.800" r="5" fill={g} />
          <path d="m14.600 16.900 1.600 1.600 2.900-3.100" stroke="#fff" strokeWidth="1.700" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </Svg>
  );
}

/** Group study: two people sharing one speech bubble. */
export function GroupIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {(g) => (
        <>
          <rect x="2.500" y="2.800" width="19" height="13" rx="4" fill={g} opacity="0.22" />
          <circle cx="8.600" cy="11" r="3" fill={g} />
          <path d="M3.200 21c0-3 2.400-5.200 5.400-5.200S14 18 14 21z" fill={g} />
          <circle cx="16.400" cy="12" r="2.400" fill={g} opacity="0.7" />
          <path d="M15.300 16.200c3-.4 5.600 1.600 5.600 4.800h-5.200" fill={g} opacity="0.7" />
        </>
      )}
    </Svg>
  );
}
