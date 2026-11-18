'use client';

import { useEffect, useMemo, useState } from 'react';
import { TOOL_ACCESS_EVENT, getToolAccess } from '@/lib/tool-unlocks';
import { CHRISTMAS_EVENT, CHRISTMAS_TOOL, christmasSwitchedOff } from '@/lib/christmas';

/** Snow, lights and a tree over the app once the Christmas code is redeemed. */
export function ChristmasMode() {
  const [unlocked, setUnlocked] = useState(false);
  const [off, setOff] = useState(true);

  useEffect(() => {
    setOff(christmasSwitchedOff());
    const load = () => getToolAccess().then((a) => setUnlocked(a.unlocked.includes(CHRISTMAS_TOOL))).catch(() => {});
    const onToggle = (e: Event) => setOff(!(e as CustomEvent<boolean>).detail);
    load();
    window.addEventListener(TOOL_ACCESS_EVENT, load);
    window.addEventListener(CHRISTMAS_EVENT, onToggle);
    return () => {
      window.removeEventListener(TOOL_ACCESS_EVENT, load);
      window.removeEventListener(CHRISTMAS_EVENT, onToggle);
    };
  }, []);

  const on = unlocked && !off;

  useEffect(() => {
    document.documentElement.classList.toggle('christmas', on);
    return () => document.documentElement.classList.remove('christmas');
  }, [on]);

  if (!on) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
      <Snow />
      <Lights />
      <Tree />
    </div>
  );
}

function Snow() {
  // Fixed positions so the flakes don't jump on every render.
  const flakes = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const r = (n: number) => ((Math.sin(i * 9301 + n * 49297) + 1) / 2);
        return {
          left: `${(r(1) * 100).toFixed(2)}%`,
          size: 4 + Math.round(r(2) * 6),
          duration: 9 + r(3) * 10,
          delay: -r(4) * 18,
          drift: Math.round((r(5) - 0.5) * 80),
          opacity: 0.45 + r(6) * 0.5,
        };
      }),
    [],
  );
  return (
    <>
      {flakes.map((f, i) => (
        <span
          key={i}
          className="xmas-flake"
          style={{
            left: f.left,
            width: f.size,
            height: f.size,
            opacity: f.opacity,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
            ['--drift' as string]: `${f.drift}px`,
          }}
        />
      ))}
    </>
  );
}

const BULB_COLOURS = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#f97316'];

function Lights() {
  const bulbs = 24;
  return (
    <svg className="absolute inset-x-0 top-0 h-9 w-full" viewBox="0 0 1200 36" preserveAspectRatio="none">
      <path d="M0 6 Q 25 22 50 6 T 100 6 T 150 6 T 200 6 T 250 6 T 300 6 T 350 6 T 400 6 T 450 6 T 500 6 T 550 6 T 600 6 T 650 6 T 700 6 T 750 6 T 800 6 T 850 6 T 900 6 T 950 6 T 1000 6 T 1050 6 T 1100 6 T 1150 6 T 1200 6"
        fill="none" stroke="#14532d" strokeWidth="2" />
      {Array.from({ length: bulbs }, (_, i) => {
        const x = 25 + i * 50;
        return (
          <g key={i}>
            <rect x={x - 3} y={12} width={6} height={4} rx={1} fill="#334155" />
            <ellipse
              cx={x}
              cy={22}
              rx={5}
              ry={7}
              fill={BULB_COLOURS[i % BULB_COLOURS.length]}
              className="xmas-bulb"
              style={{ animationDelay: `${(i % 4) * 0.45}s` }}
            />
          </g>
        );
      })}
    </svg>
  );
}

function Tree() {
  const ornaments: [number, number, string][] = [
    [48, 46, '#ef4444'], [70, 58, '#facc15'], [38, 72, '#3b82f6'], [62, 84, '#ef4444'],
    [82, 92, '#facc15'], [30, 98, '#f97316'], [54, 106, '#3b82f6'], [76, 114, '#ef4444'], [42, 118, '#facc15'],
  ];
  return (
    <svg
      className="xmas-tree absolute right-3 bottom-24 h-24 w-20 sm:h-32 sm:w-28 lg:bottom-5 lg:right-5 drop-shadow-lg"
      viewBox="0 0 110 150"
    >
      <rect x="47" y="124" width="16" height="18" rx="2" fill="#7c4a1e" />
      <polygon points="55,14 88,62 22,62" fill="#15803d" />
      <polygon points="55,34 96,94 14,94" fill="#16a34a" />
      <polygon points="55,58 104,128 6,128" fill="#15803d" />
      <path d="M30 70 Q 55 82 80 66 M22 102 Q 55 116 90 98" stroke="#fde68a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {ornaments.map(([cx, cy, c], i) => (
        <circle key={i} cx={cx} cy={cy} r="4.5" fill={c} className="xmas-bulb" style={{ animationDelay: `${(i % 3) * 0.6}s` }} />
      ))}
      <polygon
        className="xmas-star"
        points="55,2 58.5,11 68,11 60.5,17 63.5,26 55,20.5 46.5,26 49.5,17 42,11 51.5,11"
        fill="#facc15"
        stroke="#f59e0b"
        strokeWidth="1"
      />
      <rect x="10" y="132" width="22" height="14" rx="2" fill="#dc2626" />
      <rect x="19" y="132" width="4" height="14" fill="#fde68a" />
      <rect x="76" y="134" width="20" height="12" rx="2" fill="#2563eb" />
      <rect x="84" y="134" width="4" height="12" fill="#fde68a" />
    </svg>
  );
}
