'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TOOL_ACCESS_EVENT, getToolAccess } from '@/lib/tool-unlocks';
import { CHRISTMAS_EVENT, CHRISTMAS_TOOL, christmasSwitchedOff } from '@/lib/christmas';
import { supabase } from '@/lib/supabase/client';

/**
 * Christmas mode, unlocked with a redeem code. Snow that drifts away from the
 * cursor, a tree you can tap to change its lights, Santa flying past now and
 * then (tap him for presents), and presents floating down to catch.
 */
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

  return on ? <ChristmasScene /> : null;
}

// ------------------------------------------------------------------ scene

type LightMode = 'twinkle' | 'chase' | 'rainbow' | 'steady';
const MODES: LightMode[] = ['twinkle', 'chase', 'rainbow', 'steady'];
const MODE_KEY = 'tasktrack.christmas.lights';
const MODE_NAMES: Record<LightMode, string> = {
  twinkle: 'Twinkle lights ✨',
  chase: 'Chasing lights 🏃',
  rainbow: 'Rainbow lights 🌈',
  steady: 'Cosy steady glow 🕯️',
};

const MESSAGES = [
  'Ho ho ho! Finish one task today and Santa’s impressed 🎅',
  'Elf tip: 25 minutes of focus, then a cookie break 🍪',
  'You found a present! Review 5 flashcards for a festive streak 🎄',
  'Jingle all the way… to a 7 ⭐',
  'Hot chocolate break earned ☕',
  'Santa checked his list: your next deadline is in My Tasks 📋',
  'Rudolph says: quiz yourself, the answers will glow 🦌',
  'Snow day energy: knock out the hardest task first ❄️',
  'Merry Christmas from the TaskTrack elves 🎁',
];

const PRIZE_NAMES: Record<string, string> = {
  polish: 'Polish my writing',
  detector: 'AI Detector',
};

interface Prize { code: string; unlocks: string }

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string; kind: 'spark' | 'confetti' | 'star';
  rot: number; vr: number;
}
interface Flake { x: number; y: number; r: number; speed: number; phase: number; drift: number; pushX: number; pushY: number }
interface Gift { id: number; left: number; duration: number; colour: string; ribbon: string }
interface Note { id: number; x: number; y: number; text: string }

const SPARK_COLOURS = ['#fde047', '#facc15', '#fff7ae', '#ffffff'];
const CONFETTI_COLOURS = ['#ef4444', '#22c55e', '#facc15', '#3b82f6', '#f97316', '#ffffff'];
const GIFT_STYLES: [string, string][] = [['#dc2626', '#fde68a'], ['#16a34a', '#fecaca'], ['#2563eb', '#fde68a'], ['#9333ea', '#bbf7d0']];

function ChristmasScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sleighRef = useRef<HTMLButtonElement>(null);
  const particles = useRef<Particle[]>([]);
  const pointer = useRef({ x: -9999, y: -9999 });
  const sleigh = useRef<{ start: number; y: number; duration: number } | null>(null);
  const reduced = useRef(false);
  const idRef = useRef(0);

  const [mode, setMode] = useState<LightMode>('twinkle');
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [prize, setPrize] = useState<Prize | null>(null);
  const [copied, setCopied] = useState(false);
  const [shake, setShake] = useState(false);
  const [sleighOn, setSleighOn] = useState(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      const saved = window.localStorage.getItem(MODE_KEY) as LightMode | null;
      if (saved && MODES.includes(saved)) setMode(saved);
    } catch {
      // fine
    }
  }, []);

  const burst = useCallback((x: number, y: number, kind: 'spark' | 'confetti' | 'star', count = 36) => {
    if (reduced.current) return;
    const colours = kind === 'confetti' ? CONFETTI_COLOURS : SPARK_COLOURS;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * (kind === 'confetti' ? 5 : 4);
      particles.current.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (kind === 'confetti' ? 2.5 : 1),
        life: 0,
        max: 50 + Math.random() * 40,
        size: kind === 'confetti' ? 4 + Math.random() * 4 : 1.5 + Math.random() * 2.5,
        color: colours[Math.floor(Math.random() * colours.length)],
        kind,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
      });
    }
  }, []);

  const say = useCallback((x: number, y: number, text: string) => {
    const id = ++idRef.current;
    const nx = Math.min(Math.max(x, 140), window.innerWidth - 140);
    const ny = Math.max(y, 90);
    setNotes([{ id, x: nx, y: ny, text }]); // newest only, so messages never overlap
    window.setTimeout(() => setNotes((n) => n.filter((m) => m.id !== id)), 3200);
  }, []);

  const randomMessage = () => MESSAGES[Math.floor(Math.random() * MESSAGES.length)];

  const dropGift = useCallback((left?: number) => {
    const id = ++idRef.current;
    const [colour, ribbon] = GIFT_STYLES[id % GIFT_STYLES.length];
    const g: Gift = { id, left: left ?? 8 + Math.random() * 80, duration: 11 + Math.random() * 5, colour, ribbon };
    setGifts((list) => [...list.slice(-4), g]);
  }, []);

  // ---------------------------------------------------------------- tree
  const tapTree = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // fine
    }
    const r = e.currentTarget.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height * 0.12, 'star', 40);
    setShake(true);
    window.setTimeout(() => setShake(false), 600);
    say(r.left + r.width / 2 - 60, r.top - 10, MODE_NAMES[next]);
  };

  // ---------------------------------------------------------------- gifts
  // About 1 in 100 presents hides a secret redeem code. The server rolls the dice,
  // so the codes never live in the app; anything else is a festive note.
  const openGift = async (g: Gift, e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    burst(x, r.top + r.height / 2, 'confetti', 60);
    setGifts((list) => list.filter((y) => y.id !== g.id));
    let won: Prize | null = null;
    try {
      const { data } = await supabase.rpc('open_christmas_present');
      const res = data as { prize?: boolean; code?: string; unlocks?: string } | null;
      if (res?.prize && res.code && res.unlocks) won = { code: res.code, unlocks: res.unlocks };
    } catch {
      // Offline or busy: it's just a note this time.
    }
    if (won) {
      burst(window.innerWidth / 2, window.innerHeight / 2, 'star', 80);
      burst(window.innerWidth / 2, window.innerHeight / 2, 'confetti', 120);
      setCopied(false);
      setPrize(won);
    } else {
      say(x, r.top - 8, randomMessage());
    }
  };

  const copyPrize = async () => {
    if (!prize) return;
    try {
      await navigator.clipboard.writeText(prize.code);
      setCopied(true);
    } catch {
      // Clipboard blocked: the code is on screen to copy by hand.
    }
  };

  // ---------------------------------------------------------------- Santa
  const tapSanta = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 'confetti', 50);
    say(r.left + r.width / 2, r.top + r.height + 70, 'Ho ho ho! Presents incoming 🎁');
    const pct = ((r.left + r.width / 2) / window.innerWidth) * 100;
    [-8, 0, 8].forEach((d, i) => window.setTimeout(() => dropGift(Math.min(90, Math.max(4, pct + d))), i * 250));
  };

  // ---------------------------------------------------------------- timers
  useEffect(() => {
    if (reduced.current) return;
    const launchSleigh = () => {
      sleigh.current = { start: performance.now(), y: 80 + Math.random() * 120, duration: 11000 };
      setSleighOn(true);
    };
    const first = window.setTimeout(launchSleigh, 6000);
    const sleighTimer = window.setInterval(launchSleigh, 50000);
    const firstGift = window.setTimeout(() => dropGift(), 2500);
    const giftTimer = window.setInterval(() => dropGift(), 30000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(sleighTimer);
      window.clearTimeout(firstGift);
      window.clearInterval(giftTimer);
    };
  }, [dropGift]);

  // ---------------------------------------------------------------- canvas loop: snow, sparkles, Santa
  useEffect(() => {
    if (reduced.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    let flakes: Flake[] = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = w < 640 ? 55 : 110;
      flakes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.8 + Math.random() * 2.8,
        speed: 0.3 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        drift: 0.3 + Math.random() * 0.8,
        pushX: 0,
        pushY: 0,
      }));
    };
    resize();

    const onMove = (e: PointerEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    const onLeave = () => { pointer.current = { x: -9999, y: -9999 }; };
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    const dark = () => document.documentElement.classList.contains('dark');
    let raf = 0;
    let t = 0;
    const frame = () => {
      t += 1;
      ctx.clearRect(0, 0, w, h);
      const isDark = dark();

      // Snow, pushed away from the cursor.
      const px = pointer.current.x;
      const py = pointer.current.y;
      for (const f of flakes) {
        const dx = f.x - px;
        const dy = f.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < 110 * 110 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const force = (110 - d) / 110;
          f.pushX += (dx / d) * force * 1.6;
          f.pushY += (dy / d) * force * 1.2;
        }
        f.pushX *= 0.92;
        f.pushY *= 0.92;
        f.y += f.speed * (0.6 + f.r / 3) + f.pushY;
        f.x += Math.sin(t * 0.01 * f.drift + f.phase) * 0.45 + f.pushX;
        if (f.y > h + 6) { f.y = -6; f.x = Math.random() * w; }
        if (f.x > w + 6) f.x = -6;
        if (f.x < -6) f.x = w + 6;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? `rgba(255,255,255,${0.55 + f.r / 8})` : `rgba(186,212,240,${0.6 + f.r / 8})`;
        ctx.fill();
        if (!isDark && f.r > 2) {
          ctx.lineWidth = 0.6;
          ctx.strokeStyle = 'rgba(120,160,205,0.55)';
          ctx.stroke();
        }
      }

      // Santa's sleigh flies across, leaving a trail of sparkles.
      const s = sleigh.current;
      const el = sleighRef.current;
      if (s && el) {
        const p = (performance.now() - s.start) / s.duration;
        if (p >= 1) {
          sleigh.current = null;
          setSleighOn(false);
        } else {
          const x = -300 + p * (w + 600);
          const y = s.y + Math.sin(p * Math.PI * 4) * 18;
          el.style.transform = `translate(${x}px, ${y}px) rotate(${Math.cos(p * Math.PI * 4) * -4}deg)`;
          if (t % 2 === 0) {
            particles.current.push({
              x: x + 10, y: y + el.offsetHeight * 0.82 + Math.random() * 6, vx: -0.6 - Math.random(), vy: 0.3 + Math.random() * 0.6,
              life: 0, max: 45 + Math.random() * 25, size: 1.2 + Math.random() * 2,
              color: SPARK_COLOURS[Math.floor(Math.random() * SPARK_COLOURS.length)], kind: 'spark', rot: 0, vr: 0,
            });
          }
        }
      }

      // Sparkles and confetti.
      const next: Particle[] = [];
      for (const q of particles.current) {
        q.life += 1;
        if (q.life > q.max) continue;
        q.x += q.vx;
        q.y += q.vy;
        q.vy += q.kind === 'confetti' ? 0.12 : 0.04;
        q.vx *= 0.98;
        q.rot += q.vr;
        const alpha = 1 - q.life / q.max;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = q.color;
        if (q.kind === 'confetti') {
          ctx.save();
          ctx.translate(q.x, q.y);
          ctx.rotate(q.rot);
          ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
          ctx.restore();
        } else if (q.kind === 'star') {
          drawStar(ctx, q.x, q.y, q.size * 1.8, q.rot);
        } else {
          ctx.shadowColor = q.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        next.push(q);
      }
      ctx.globalAlpha = 1;
      particles.current = next.slice(-600);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div data-xmode={mode} className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0" />
      <Lights />
      <SnowDrift />

      {sleighOn && (
        <button
          ref={sleighRef}
          type="button"
          onClick={tapSanta}
          aria-label="Santa’s sleigh: tap for presents"
          className="pointer-events-auto absolute left-0 top-0 select-none drop-shadow-lg will-change-transform"
          style={{ transform: 'translate(-300px, 100px)' }}
        >
          <SantaSleigh />
          <span className="absolute bottom-full left-0 mb-4 w-max max-w-[230px] whitespace-normal rounded-2xl border border-red-200 bg-white/95 px-3 py-1.5 text-left text-xs font-semibold leading-snug text-slate-800 shadow-lg dark:border-red-900 dark:bg-slate-900/95 dark:text-slate-100 sm:text-sm">
            Ho ho ho! There might be a secret redeem code in my presents… or just a note 🎁
          </span>
        </button>
      )}

      {gifts.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={(e) => openGift(g, e)}
          onAnimationEnd={() => setGifts((list) => list.filter((x) => x.id !== g.id))}
          aria-label="A present: tap to open"
          className="xmas-gift pointer-events-auto absolute top-0"
          style={{ left: `${g.left}%`, animationDuration: `${g.duration}s` }}
        >
          <GiftBox colour={g.colour} ribbon={g.ribbon} />
        </button>
      ))}

      <button
        type="button"
        onClick={tapTree}
        aria-label="Christmas tree: tap to change the lights"
        title="Tap me!"
        className={`xmas-tree-btn pointer-events-auto absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] right-2 sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:right-4 ${shake ? 'xmas-shake' : ''}`}
      >
        <Tree />
      </button>

      {notes.map((n) => (
        <div
          key={n.id}
          role="status"
          className="xmas-note absolute max-w-[260px] -translate-x-1/2 -translate-y-full rounded-2xl border border-red-200 bg-white/95 px-3.5 py-2 text-center text-sm font-semibold text-slate-800 shadow-lg dark:border-red-900 dark:bg-slate-900/95 dark:text-slate-100"
          style={{ left: n.x, top: n.y }}
        >
          {n.text}
        </div>
      ))}

      {prize && (
        <div className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setPrize(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="xmas-prize-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 rounded-2xl border-2 border-red-300 bg-white p-5 text-center shadow-2xl dark:border-red-800 dark:bg-slate-900"
          >
            <p className="text-4xl" aria-hidden>🎁✨</p>
            <h2 id="xmas-prize-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">You found a secret code!</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              It unlocks <strong>{PRIZE_NAMES[prize.unlocks] ?? 'a hidden tool'}</strong>. Only about 1 in 100 presents has one.
            </p>
            <p className="select-all rounded-lg border border-dashed border-red-300 bg-red-50 px-3 py-2 font-mono text-lg font-bold tracking-wider text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {prize.code}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={copyPrize} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">
                {copied ? 'Copied ✓' : 'Copy code'}
              </button>
              <a href="/app/tools?tool=redeem" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700">
                Redeem it now
              </a>
              <button type="button" onClick={() => setPrize(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Santa sitting in his sleigh with the reins, pulled by two galloping reindeer. */
function SantaSleigh() {
  return (
    <svg viewBox="0 0 270 100" className="h-[64px] w-[173px] sm:h-[84px] sm:w-[227px] overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="xs-sleigh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ef4444" />
          <stop offset="1" stopColor="#991b1b" />
        </linearGradient>
        <linearGradient id="xs-coat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ef4444" />
          <stop offset="1" stopColor="#b91c1c" />
        </linearGradient>
        <linearGradient id="xs-deer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a16207" />
          <stop offset="1" stopColor="#713f12" />
        </linearGradient>
      </defs>

      {/* Reins from Santa's hands to the reindeer */}
      <path d="M100 47 C 130 40, 150 44, 172 46" stroke="#7c2d12" strokeWidth="1.6" fill="none" />
      <path d="M100 47 C 150 36, 200 40, 228 42" stroke="#7c2d12" strokeWidth="1.6" fill="none" />

      {/* Reindeer (back one first so the front one overlaps) */}
      <Reindeer x={160} y={44} />
      <Reindeer x={214} y={36} lead />

      {/* Sack of presents behind Santa */}
      <path d="M22 58 C 14 40, 22 22, 38 20 C 50 18, 56 30, 54 58 Z" fill="#15803d" />
      <path d="M30 22 C 34 16, 42 16, 44 21" stroke="#fde68a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="30" y="10" width="13" height="11" rx="1.5" fill="#2563eb" />
      <rect x="35.5" y="10" width="2.5" height="11" fill="#fde68a" />

      {/* Santa */}
      <g>
        {/* body */}
        <path d="M54 62 C 52 42, 60 32, 72 32 C 86 32, 92 44, 90 62 Z" fill="url(#xs-coat)" />
        <path d="M71 34 L71 62" stroke="#fff" strokeWidth="3" />
        {/* arm reaching forward with the reins */}
        <path d="M80 42 C 88 44, 94 46, 99 47" stroke="url(#xs-coat)" strokeWidth="8" strokeLinecap="round" fill="none" />
        <circle cx="93" cy="45.5" r="4.2" fill="#fff" />
        <circle cx="100" cy="47" r="3.8" fill="#1f2937" />
        {/* head */}
        <circle cx="73" cy="24" r="9" fill="#f6c7a1" />
        {/* beard */}
        <path d="M63 25 C 63 40, 72 44, 76 42 C 84 40, 84 30, 82 25 C 79 30, 67 30, 63 25 Z" fill="#fff" />
        <path d="M70 29 C 72 27.5, 76 27.5, 78 29" stroke="#e5e7eb" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* face */}
        <circle cx="77" cy="21.5" r="1.2" fill="#1f2937" />
        <circle cx="79.5" cy="25" r="2" fill="#fca5a5" opacity="0.9" />
        <circle cx="80.5" cy="23.5" r="1.6" fill="#f4a582" />
        {/* hat, flopping back in the wind */}
        <path d="M63 19 C 64 8, 76 5, 83 15 C 74 11, 64 14, 56 22 Z" fill="url(#xs-coat)" />
        <circle cx="55" cy="23" r="3.6" fill="#fff" />
        <rect x="62" y="15" width="22" height="5.5" rx="2.75" fill="#fff" transform="rotate(8 73 18)" />
      </g>

      {/* Sleigh body, in front of Santa's legs */}
      <path
        d="M14 56 C 12 48, 18 44, 24 48 L 30 54 L 102 54 C 112 54, 118 46, 124 40 C 128 37, 133 41, 129 46 C 122 56, 116 72, 98 74 L 30 74 C 20 74, 15 66, 14 56 Z"
        fill="url(#xs-sleigh)"
      />
      <path d="M22 60 L 108 60" stroke="#fbbf24" strokeWidth="2" />
      <circle cx="40" cy="66" r="3" fill="#fbbf24" />
      <circle cx="64" cy="66" r="3" fill="#fbbf24" />
      <circle cx="88" cy="66" r="3" fill="#fbbf24" />
      {/* runners */}
      <path d="M30 74 L 30 82 M 92 74 L 92 82" stroke="#d4a017" strokeWidth="2.5" />
      <path d="M10 84 L 120 84 C 130 84, 134 76, 128 74" stroke="#fbbf24" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Reindeer({ x, y, lead = false }: { x: number; y: number; lead?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* back legs */}
      <g className="xmas-leg-a" style={{ transformOrigin: 'right top' }}>
        <path d="M6 12 L 0 24" stroke="#713f12" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="xmas-leg-b" style={{ transformOrigin: 'right top' }}>
        <path d="M10 12 L 6 25" stroke="#5b3410" strokeWidth="3" strokeLinecap="round" />
      </g>
      {/* front legs */}
      <g className="xmas-leg-b" style={{ transformOrigin: 'left top' }}>
        <path d="M30 12 L 40 22" stroke="#713f12" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="xmas-leg-a" style={{ transformOrigin: 'left top' }}>
        <path d="M27 12 L 34 25" stroke="#5b3410" strokeWidth="3" strokeLinecap="round" />
      </g>
      {/* body and tail */}
      <ellipse cx="18" cy="9" rx="17" ry="8" fill="url(#xs-deer)" />
      <ellipse cx="2" cy="5" rx="3.5" ry="2.5" fill="#fff" />
      {/* harness with a bell */}
      <path d="M8 3 C 12 14, 24 14, 28 3" stroke="#b91c1c" strokeWidth="2.5" fill="none" />
      <circle cx="18" cy="13" r="2.2" fill="#fbbf24" />
      {/* neck and head */}
      <path d="M28 6 C 32 -2, 34 -6, 36 -8 L 41 -5 C 38 0, 36 6, 33 10 Z" fill="url(#xs-deer)" />
      <ellipse cx="42" cy="-8" rx="7" ry="4.2" fill="#8a5a1c" transform="rotate(15 42 -8)" />
      <circle cx="49" cy="-6" r={lead ? 2.4 : 1.8} fill={lead ? '#ef4444' : '#3f2a14'} />
      <circle cx="41" cy="-10" r="1" fill="#111827" />
      <path d="M36 -11 L 33 -14" stroke="#713f12" strokeWidth="2.5" strokeLinecap="round" />
      {/* antlers */}
      <path d="M39 -12 C 37 -20, 33 -24, 28 -25 M 35 -19 L 30 -18 M 41 -12 C 42 -20, 46 -24, 50 -26 M 44 -20 L 48 -18" stroke="#a16207" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </g>
  );
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ pieces

const BULBS = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#f97316', '#ec4899'];

function Lights() {
  const n = 28;
  const step = 1200 / n;
  const wire = Array.from({ length: n }, (_, i) => `Q ${i * step + step / 2} 16 ${(i + 1) * step} 3`).join(' ');
  return (
    <svg aria-hidden className="absolute inset-x-0 top-0 h-6 w-full sm:h-7" viewBox="0 0 1200 34" preserveAspectRatio="none">
      <defs>
        <filter id="xmas-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={`M 0 3 ${wire}`} fill="none" stroke="#14532d" strokeWidth="1.6" />
      {Array.from({ length: n }, (_, i) => {
        const x = i * step + step / 2;
        return (
          <g key={i}>
            <rect x={x - 2.5} y={9} width={5} height={4} rx={1} fill="#475569" />
            <ellipse
              cx={x} cy={20} rx={4.2} ry={7}
              fill={BULBS[i % BULBS.length]}
              filter="url(#xmas-glow)"
              className="xb"
              style={{ ['--i' as string]: i }}
            />
          </g>
        );
      })}
    </svg>
  );
}

function SnowDrift() {
  return (
    <svg aria-hidden className="absolute inset-x-0 bottom-0 hidden h-7 w-full lg:block" viewBox="0 0 1200 28" preserveAspectRatio="none">
      <path
        d="M0 28 L0 16 Q 60 4 130 14 T 270 12 T 420 15 T 560 10 T 700 15 T 850 11 T 990 15 T 1120 10 T 1200 14 L1200 28 Z"
        className="fill-white/90 dark:fill-slate-200/80"
        style={{ filter: 'drop-shadow(0 -2px 3px rgba(120,160,205,0.35))' }}
      />
    </svg>
  );
}

/** The scalloped bottom edge of a tier, right to left. */
function tierEdge(bottom: number, half: number): string {
  const cx = 80;
  const scallops = 5;
  const w = (half * 2) / scallops;
  let d = `M ${cx + half} ${bottom}`;
  for (let i = 0; i < scallops; i++) {
    const x2 = cx + half - (i + 1) * w;
    d += ` Q ${x2 + w / 2} ${bottom - 7} ${x2} ${bottom}`;
  }
  return d;
}

function tierPath(top: number, bottom: number, half: number): string {
  return `M 80 ${top} L ${80 + half} ${bottom} ${tierEdge(bottom, half).slice(1)} Z`;
}

function Tree() {
  const tiers = useMemo(() => [
    { top: 26, bottom: 82, half: 36 },
    { top: 50, bottom: 124, half: 52 },
    { top: 84, bottom: 168, half: 68 },
  ], []);
  // Bulbs along three garlands.
  const bulbs = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    const lines = [[50, 66, 108, 74, 7], [38, 104, 124, 112, 9], [24, 148, 140, 156, 11]];
    for (const [x1, y1, x2, y2, count] of lines) {
      for (let i = 0; i < count; i++) {
        const tt = i / (count - 1);
        out.push({ x: x1 + (x2 - x1) * tt, y: y1 + (y2 - y1) * tt + Math.sin(tt * Math.PI) * 7 });
      }
    }
    return out;
  }, []);
  const baubles: [number, number, string][] = [
    [70, 92, '#dc2626'], [96, 132, '#2563eb'], [58, 138, '#facc15'], [104, 96, '#a855f7'], [78, 160, '#dc2626'], [44, 160, '#16a34a'], [120, 162, '#facc15'],
  ];
  return (
    <svg aria-hidden className="xmas-tree h-20 w-[60px] sm:h-24 sm:w-[72px] lg:h-36 lg:w-[108px] drop-shadow-xl" viewBox="0 0 160 214">
      <defs>
        <linearGradient id="xt-green" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="55%" stopColor="#15803d" />
          <stop offset="100%" stopColor="#14532d" />
        </linearGradient>
        <radialGradient id="xt-gold" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fff7ae" />
          <stop offset="60%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#d97706" />
        </radialGradient>
        <radialGradient id="xt-halo">
          <stop offset="0%" stopColor="rgba(253,224,71,0.85)" />
          <stop offset="100%" stopColor="rgba(253,224,71,0)" />
        </radialGradient>
        <filter id="xt-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <rect x="70" y="164" width="20" height="24" rx="3" fill="#78350f" />
      <rect x="70" y="164" width="7" height="24" rx="2" fill="#92400e" />

      {tiers.map((t, i) => (
        <g key={i}>
          <path d={tierPath(t.top, t.bottom, t.half)} fill="url(#xt-green)" />
          {/* snow on the edges */}
          <path d={`M ${80 - t.half * 0.18} ${t.top + (t.bottom - t.top) * 0.18} L 80 ${t.top} L ${80 + t.half * 0.18} ${t.top + (t.bottom - t.top) * 0.18}`} stroke="#fff" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.9" />
          <path d={tierEdge(t.bottom, t.half)} stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.85" />
        </g>
      ))}

      {/* garland wires */}
      <path d="M50 66 Q 79 82 108 74" stroke="#fde68a" strokeWidth="1.2" fill="none" opacity="0.8" />
      <path d="M38 104 Q 81 122 124 112" stroke="#fde68a" strokeWidth="1.2" fill="none" opacity="0.8" />
      <path d="M24 148 Q 82 168 140 156" stroke="#fde68a" strokeWidth="1.2" fill="none" opacity="0.8" />

      {baubles.map(([cx, cy, c], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="5.5" fill={c} />
          <circle cx={cx - 1.8} cy={cy - 1.8} r="1.6" fill="#fff" opacity="0.75" />
        </g>
      ))}

      {bulbs.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r="2.6" fill={BULBS[i % BULBS.length]} filter="url(#xt-glow)" className="xb" style={{ ['--i' as string]: i }} />
      ))}

      <circle cx="80" cy="22" r="20" fill="url(#xt-halo)" className="xmas-halo" />
      <polygon className="xmas-star" points="80,4 84.5,16 97,16 87,23.5 91,36 80,28.5 69,36 73,23.5 63,16 75.5,16" fill="url(#xt-gold)" stroke="#b45309" strokeWidth="0.8" />

      <GiftShape x={30} y={186} w={30} h={22} colour="#dc2626" ribbon="#fde68a" />
      <GiftShape x={98} y={190} w={26} h={18} colour="#2563eb" ribbon="#fecaca" />
      <GiftShape x={62} y={194} w={22} h={14} colour="#16a34a" ribbon="#fde68a" />
    </svg>
  );
}

function GiftShape({ x, y, w, h, colour, ribbon }: { x: number; y: number; w: number; h: number; colour: string; ribbon: string }) {
  const cx = x + w / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="2" fill={colour} />
      <rect x={x - 1} y={y - 1} width={w + 2} height={5} rx="1.5" fill={colour} stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />
      <rect x={cx - 2} y={y - 1} width={4} height={h + 1} fill={ribbon} />
      <path d={`M ${cx} ${y - 1} q -7 -8 -9 -1 q 2 4 9 1 q 7 3 9 -1 q -2 -7 -9 1`} fill={ribbon} />
    </g>
  );
}

function GiftBox({ colour, ribbon }: { colour: string; ribbon: string }) {
  return (
    <svg viewBox="0 0 60 92" className="h-[78px] w-[52px] drop-shadow-lg">
      {/* parachute */}
      <path d="M4 26 Q 30 -6 56 26 Q 49 21 43 26 Q 36 20 30 26 Q 24 20 17 26 Q 11 21 4 26 Z" fill="#fff" stroke="#cbd5e1" />
      <path d="M17 26 Q 30 2 43 26" fill="#fecaca" opacity="0.8" />
      <path d="M4 26 L 18 58 M56 26 L 42 58 M30 26 L 30 58" stroke="#94a3b8" strokeWidth="0.8" />
      <rect x="14" y="58" width="32" height="28" rx="3" fill={colour} />
      <rect x="12" y="56" width="36" height="7" rx="2" fill={colour} stroke="rgba(0,0,0,0.15)" />
      <rect x="27.5" y="56" width="5" height="30" fill={ribbon} />
      <path d="M30 56 q -9 -10 -12 -1 q 3 5 12 1 q 9 4 12 -1 q -3 -9 -12 1" fill={ribbon} />
    </svg>
  );
}
