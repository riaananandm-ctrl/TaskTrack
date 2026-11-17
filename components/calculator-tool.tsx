'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Home, ZoomIn, ZoomOut, Keyboard, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { parse, evaluate, freeVariables, formatNumber, ExprError, type Node } from '@/lib/math-expr';

/**
 * Graphing calculator in the style of Desmos: a list of expressions on the left and a
 * live graph on the right. Each row can be
 *   - a plain sum           2+3*4            → shows = 14
 *   - a graph               y = x^2 - 1   or   sin(x)
 *   - a function            f(x) = x^3       (graphed, and usable in other rows)
 *   - a variable / slider   a = 2            (slider appears; use a in other rows)
 *   - a vertical line       x = 3
 *   - a point               (2, 4)
 */

const COLORS = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#000000'];
const STORAGE_KEY = 'tasktrack.graphcalc.v1';

interface Row {
  id: number;
  text: string;
  hidden?: boolean;
  slider?: { min: number; max: number; step: number };
}

type Kind =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'value'; value: number }
  | { kind: 'variable'; name: string; value: number; isNumber: boolean }
  | { kind: 'function'; name: string; node: Node }
  | { kind: 'graph'; node: Node }
  | { kind: 'vline'; value: number }
  | { kind: 'point'; x: number; y: number };

interface View { cx: number; cy: number; scale: number } // scale = pixels per unit

const DEFAULT_VIEW: View = { cx: 0, cy: 0, scale: 40 };
const DEFAULT_ROWS: Row[] = [
  { id: 1, text: 'y = x^2 - 2' },
  { id: 2, text: 'y = a sin(x)' },
  { id: 3, text: 'a = 2' },
  { id: 4, text: '' },
];

const KEYPAD: Array<{ label: string; insert: string }> = [
  { label: 'x', insert: 'x' }, { label: 'y', insert: 'y' }, { label: 'a²', insert: '^2' }, { label: 'aᵇ', insert: '^' },
  { label: '7', insert: '7' }, { label: '8', insert: '8' }, { label: '9', insert: '9' }, { label: '÷', insert: '/' },
  { label: '(', insert: '(' }, { label: ')', insert: ')' }, { label: '√', insert: 'sqrt(' }, { label: 'π', insert: 'pi' },
  { label: '4', insert: '4' }, { label: '5', insert: '5' }, { label: '6', insert: '6' }, { label: '×', insert: '*' },
  { label: 'sin', insert: 'sin(' }, { label: 'cos', insert: 'cos(' }, { label: 'tan', insert: 'tan(' }, { label: '|a|', insert: 'abs(' },
  { label: '1', insert: '1' }, { label: '2', insert: '2' }, { label: '3', insert: '3' }, { label: '−', insert: '-' },
  { label: 'ln', insert: 'ln(' }, { label: 'log', insert: 'log(' }, { label: 'eˣ', insert: 'e^' }, { label: '=', insert: ' = ' },
  { label: '0', insert: '0' }, { label: '.', insert: '.' }, { label: ',', insert: ', ' }, { label: '+', insert: '+' },
];

function loadRows(): Row[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ROWS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((r) => typeof r?.id === 'number' && typeof r?.text === 'string')) {
      return parsed.length ? parsed : DEFAULT_ROWS;
    }
  } catch {
    // ignore
  }
  return DEFAULT_ROWS;
}

/** Work out what every row means, resolving variables and functions across rows. */
function analyse(rows: Row[], degrees: boolean): Kind[] {
  const vars = new Map<string, number>();
  const fns = new Map<string, { param: string; node: Node }>();
  const fnNames = new Set<string>();

  // Collect function names first so f(2) parses as a call, not f*(2).
  for (const r of rows) {
    const m = /^\s*([A-Za-z])\s*\(\s*([A-Za-z])\s*\)\s*=/.exec(r.text);
    if (m && m[1] !== 'y') fnNames.add(m[1]);
  }

  const results: Kind[] = rows.map(() => ({ kind: 'empty' }));
  const scope = (extra?: Record<string, number>) => ({
    degrees,
    get: (name: string) => (extra && name in extra ? extra[name] : vars.get(name)),
    fn: (name: string) => {
      const f = fns.get(name);
      if (!f) return undefined;
      return (v: number) => evaluate(f.node, scope({ ...extra, [f.param]: v }));
    },
  });

  // Several passes so a row can use a variable defined further down.
  for (let pass = 0; pass < 4; pass++) {
    rows.forEach((row, i) => {
      const text = row.text.trim();
      if (!text) { results[i] = { kind: 'empty' }; return; }
      try {
        // Point: (x, y)
        const point = /^\((.+),(.+)\)$/.exec(text);
        if (point && !/^\(.*\)\s*[*/+^-]/.test(text)) {
          const x = evaluate(parse(point[1], { fnNames }), scope());
          const y = evaluate(parse(point[2], { fnNames }), scope());
          results[i] = { kind: 'point', x, y };
          return;
        }
        // Function definition: f(x) = ...
        const fdef = /^([A-Za-z])\s*\(\s*([A-Za-z])\s*\)\s*=(.+)$/.exec(text);
        if (fdef && fdef[1] !== 'y') {
          const node = parse(fdef[3], { fnNames });
          fns.set(fdef[1], { param: fdef[2], node });
          results[i] = { kind: 'function', name: fdef[1], node: fdef[2] === 'x' ? node : renameVar(node, fdef[2], 'x') };
          return;
        }
        const eq = text.indexOf('=');
        if (eq > 0 && !/[<>!]=|=[=<>]/.test(text)) {
          const lhs = text.slice(0, eq).trim();
          const rhs = text.slice(eq + 1).trim();
          if (!rhs) { results[i] = { kind: 'error', message: 'Add something after =' }; return; }
          if (lhs === 'y') {
            const node = parse(rhs, { fnNames });
            results[i] = { kind: 'graph', node };
            return;
          }
          if (lhs === 'x') {
            const node = parse(rhs, { fnNames });
            if (freeVariables(node).has('y')) throw new ExprError('Write it as y = ...');
            results[i] = { kind: 'vline', value: evaluate(node, scope()) };
            return;
          }
          if (/^[A-Za-z][A-Za-z0-9_]*$/.test(lhs) && !['e', 'pi'].includes(lhs)) {
            const node = parse(rhs, { fnNames });
            if (freeVariables(node).has('x')) {
              results[i] = { kind: 'error', message: `Use y = … or ${lhs}(x) = … to graph` };
              return;
            }
            const value = evaluate(node, scope());
            vars.set(lhs, value);
            results[i] = { kind: 'variable', name: lhs, value, isNumber: node.type === 'num' || (node.type === 'unary' && node.arg.type === 'num') };
            return;
          }
          throw new ExprError('Try y = … , f(x) = … or a = …');
        }
        const node = parse(text, { fnNames });
        const free = freeVariables(node);
        if (free.has('x')) { results[i] = { kind: 'graph', node }; return; }
        results[i] = { kind: 'value', value: evaluate(node, scope()) };
      } catch (err) {
        results[i] = { kind: 'error', message: err instanceof ExprError ? err.message : 'Check this expression' };
      }
    });
  }

  // Graph evaluators need the final scope; return it through closures.
  (results as Array<Kind & { evalAt?: (x: number) => number }>).forEach((r) => {
    if (r.kind === 'graph' || r.kind === 'function') {
      const node = r.node;
      (r as { evalAt?: (x: number) => number }).evalAt = (x: number) => {
        try { return evaluate(node, scope({ x })); } catch { return NaN; }
      };
    }
  });
  return results;
}

function renameVar(node: Node, from: string, to: string): Node {
  switch (node.type) {
    case 'var': return node.name === from ? { type: 'var', name: to } : node;
    case 'unary': return { ...node, arg: renameVar(node.arg, from, to) };
    case 'post': return { ...node, arg: renameVar(node.arg, from, to) };
    case 'bin': return { ...node, left: renameVar(node.left, from, to), right: renameVar(node.right, from, to) };
    case 'call': return { ...node, args: node.args.map((a) => renameVar(a, from, to)) };
    default: return node;
  }
}

function niceStep(scale: number): number {
  const target = 90 / scale; // about 90px between labelled grid lines
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const n = target / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

function label(v: number, step: number): string {
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const s = v.toFixed(Math.min(digits, 10));
  return s === '-0' ? '0' : s;
}

export function CalculatorTool() {
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS);
  const [loaded, setLoaded] = useState(false);
  const [degrees, setDegrees] = useState(false);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [showKeypad, setShowKeypad] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; color: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef(new Map<number, HTMLInputElement>());
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const [size, setSize] = useState({ w: 600, h: 420 });

  useEffect(() => { setRows(loadRows()); setLoaded(true); }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
  }, [rows, loaded]);

  const results = useMemo(() => analyse(rows, degrees), [rows, degrees]);

  // Keep the canvas sized to its box.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(200, Math.round(r.width)), h: Math.max(260, Math.round(r.height)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toScreen = useCallback((x: number, y: number) => ({
    sx: size.w / 2 + (x - view.cx) * view.scale,
    sy: size.h / 2 - (y - view.cy) * view.scale,
  }), [size, view]);
  const toWorld = useCallback((sx: number, sy: number) => ({
    x: view.cx + (sx - size.w / 2) / view.scale,
    y: view.cy - (sy - size.h / 2) / view.scale,
  }), [size, view]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);

    const step = niceStep(view.scale);
    const minor = step / 5;
    const left = toWorld(0, 0).x;
    const right = toWorld(size.w, 0).x;
    const top = toWorld(0, 0).y;
    const bottom = toWorld(0, size.h).y;

    const gridLines = (s: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(left / s) * s; x <= right; x += s) {
        const { sx } = toScreen(x, 0);
        ctx.moveTo(Math.round(sx) + 0.5, 0);
        ctx.lineTo(Math.round(sx) + 0.5, size.h);
      }
      for (let y = Math.ceil(bottom / s) * s; y <= top; y += s) {
        const { sy } = toScreen(0, y);
        ctx.moveTo(0, Math.round(sy) + 0.5);
        ctx.lineTo(size.w, Math.round(sy) + 0.5);
      }
      ctx.stroke();
    };
    gridLines(minor, '#f1f1f1');
    gridLines(step, '#dcdcdc');

    // Axes.
    const origin = toScreen(0, 0);
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, origin.sy); ctx.lineTo(size.w, origin.sy);
    ctx.moveTo(origin.sx, 0); ctx.lineTo(origin.sx, size.h);
    ctx.stroke();

    // Labels.
    ctx.fillStyle = '#555';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    const labelY = Math.min(Math.max(origin.sy + 14, 14), size.h - 4);
    ctx.textAlign = 'center';
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      if (Math.abs(x) < step / 2) continue;
      const { sx } = toScreen(x, 0);
      ctx.fillText(label(x, step), sx, labelY);
    }
    ctx.textAlign = 'right';
    const labelX = Math.min(Math.max(origin.sx - 5, 30), size.w - 4);
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      if (Math.abs(y) < step / 2) continue;
      const { sy } = toScreen(0, y);
      ctx.fillText(label(y, step), labelX, sy + 4);
    }
    ctx.textAlign = 'right';
    ctx.fillText('0', origin.sx - 5, origin.sy + 14);

    // Curves.
    results.forEach((r, i) => {
      if (rows[i]?.hidden) return;
      const color = COLORS[i % COLORS.length];
      const evalAt = (r as { evalAt?: (x: number) => number }).evalAt;
      if ((r.kind === 'graph' || r.kind === 'function') && evalAt) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let penDown = false;
        let prevSy = 0;
        for (let px = 0; px <= size.w; px += 1) {
          const { x } = toWorld(px, 0);
          const y = evalAt(x);
          if (!Number.isFinite(y)) { penDown = false; continue; }
          const { sy } = toScreen(x, y);
          // Break the line across asymptotes such as tan(x) or 1/x.
          if (penDown && Math.abs(sy - prevSy) > size.h * 2) penDown = false;
          const clamped = Math.max(-size.h * 4, Math.min(size.h * 5, sy));
          if (penDown) ctx.lineTo(px, clamped); else ctx.moveTo(px, clamped);
          penDown = true;
          prevSy = sy;
        }
        ctx.stroke();
      } else if (r.kind === 'vline' && Number.isFinite(r.value)) {
        const { sx } = toScreen(r.value, 0);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, size.h); ctx.stroke();
      } else if (r.kind === 'point' && Number.isFinite(r.x) && Number.isFinite(r.y)) {
        const { sx, sy } = toScreen(r.x, r.y);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#333';
        ctx.textAlign = 'left';
        ctx.fillText(`(${formatNumber(r.x)}, ${formatNumber(r.y)})`, sx + 8, sy - 8);
      }
    });

    if (hover) {
      const { sx, sy } = toScreen(hover.x, hover.y);
      ctx.fillStyle = hover.color;
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
      const text = `(${formatNumber(Number(hover.x.toFixed(4)))}, ${formatNumber(Number(hover.y.toFixed(4)))})`;
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
      const w = ctx.measureText(text).width + 12;
      const bx = Math.min(sx + 10, size.w - w - 4);
      const by = Math.max(sy - 30, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = '#ccc';
      ctx.fillRect(bx, by, w, 22);
      ctx.strokeRect(bx, by, w, 22);
      ctx.fillStyle = '#222';
      ctx.textAlign = 'left';
      ctx.fillText(text, bx + 6, by + 15);
    }
  }, [results, rows, view, size, hover, toScreen, toWorld]);

  // Mouse wheel zoom around the cursor (non-passive so the page does not scroll).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.min(1e6, Math.max(1e-3, v.scale * factor));
        const wx = v.cx + (mx - size.w / 2) / v.scale;
        const wy = v.cy - (my - size.h / 2) / v.scale;
        return { scale, cx: wx - (mx - size.w / 2) / scale, cy: wy + (my - size.h / 2) / scale };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [size]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (drag.current) {
      const d = drag.current;
      setView({ ...d.view, cx: d.view.cx - (e.clientX - d.x) / d.view.scale, cy: d.view.cy + (e.clientY - d.y) / d.view.scale });
      setHover(null);
      return;
    }
    // Trace: snap to the nearest curve under the cursor.
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { x } = toWorld(mx, my);
    let best: { x: number; y: number; color: string; d: number } | null = null;
    results.forEach((r, i) => {
      if (rows[i]?.hidden) return;
      const evalAt = (r as { evalAt?: (x: number) => number }).evalAt;
      if (!evalAt) return;
      const y = evalAt(x);
      if (!Number.isFinite(y)) return;
      const d = Math.abs(toScreen(x, y).sy - my);
      if (d < 24 && (!best || d < best.d)) best = { x, y, color: COLORS[i % COLORS.length], d };
    });
    setHover(best);
  };
  const onPointerUp = () => { drag.current = null; };

  const zoom = (factor: number) => setView((v) => ({ ...v, scale: Math.min(1e6, Math.max(1e-3, v.scale * factor)) }));

  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = (afterId?: number) => {
    const id = Date.now();
    setRows((rs) => {
      const idx = afterId == null ? rs.length - 1 : rs.findIndex((r) => r.id === afterId);
      const next = [...rs];
      next.splice(idx + 1, 0, { id, text: '' });
      return next;
    });
    setFocusId(id);
    setTimeout(() => inputRefs.current.get(id)?.focus(), 0);
  };
  const removeRow = (id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : [{ id: Date.now(), text: '' }]));

  const insertText = (insert: string) => {
    const id = focusId ?? rows[rows.length - 1]?.id;
    if (id == null) return;
    const input = inputRefs.current.get(id);
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const start = input?.selectionStart ?? row.text.length;
    const end = input?.selectionEnd ?? row.text.length;
    const text = row.text.slice(0, start) + insert + row.text.slice(end);
    updateRow(id, { text });
    setTimeout(() => {
      input?.focus();
      const pos = start + insert.length;
      input?.setSelectionRange(pos, pos);
    }, 0);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5 text-xs font-medium" role="group" aria-label="Angle units">
          <button type="button" onClick={() => setDegrees(false)} className={cn('px-2.5 py-1 rounded-md', !degrees ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>Radians</button>
          <button type="button" onClick={() => setDegrees(true)} className={cn('px-2.5 py-1 rounded-md', degrees ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>Degrees</button>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowKeypad((s) => !s)} aria-pressed={showKeypad}>
          <Keyboard className="w-3.5 h-3.5 mr-1" /> Keypad
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => { setRows([{ id: Date.now(), text: '' }]); }}>
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear all
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-3">
        {/* Expression list */}
        <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col max-h-[560px]">
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {rows.map((row, i) => {
              const r = results[i];
              const color = COLORS[i % COLORS.length];
              const graphable = r && ['graph', 'function', 'vline', 'point'].includes(r.kind);
              return (
                <div key={row.id} className={cn('flex gap-2 px-2 py-2', focusId === row.id && 'bg-primary/[0.04]')}>
                  <div className="flex flex-col items-center pt-1.5 w-6 flex-shrink-0">
                    <span className="text-[10px] text-muted-foreground">{i + 1}</span>
                    {graphable && (
                      <button
                        type="button"
                        onClick={() => updateRow(row.id, { hidden: !row.hidden })}
                        className="mt-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        aria-label={row.hidden ? 'Show on graph' : 'Hide from graph'}
                        title={row.hidden ? 'Show on graph' : 'Hide from graph'}
                      >
                        {row.hidden
                          ? <EyeOff className="w-4 h-4 text-muted-foreground" />
                          : <span className="block w-4 h-4 rounded-full" style={{ background: color }} />}
                      </button>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <input
                      ref={(el) => { if (el) inputRefs.current.set(row.id, el); else inputRefs.current.delete(row.id); }}
                      value={row.text}
                      onChange={(e) => updateRow(row.id, { text: e.target.value })}
                      onFocus={() => setFocusId(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addRow(row.id); }
                        if (e.key === 'Backspace' && row.text === '' && rows.length > 1) {
                          e.preventDefault();
                          const prev = rows[i - 1] ?? rows[i + 1];
                          removeRow(row.id);
                          if (prev) setTimeout(() => inputRefs.current.get(prev.id)?.focus(), 0);
                        }
                      }}
                      placeholder={i === rows.length - 1 ? 'Type y = x^2, f(x) = …, a = 3 or 2+2' : ''}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label={`Expression ${i + 1}`}
                      className="w-full bg-transparent font-mono text-[15px] py-1 outline-none placeholder:text-muted-foreground/60 placeholder:font-sans placeholder:text-xs"
                    />
                    {r?.kind === 'value' && (
                      <p className="text-right font-mono text-sm text-foreground/80">= {formatNumber(r.value)}</p>
                    )}
                    {r?.kind === 'variable' && !r.isNumber && (
                      <p className="text-right font-mono text-sm text-foreground/80">= {formatNumber(r.value)}</p>
                    )}
                    {r?.kind === 'variable' && r.isNumber && (
                      <Slider
                        row={row}
                        value={r.value}
                        onChange={(v) => updateRow(row.id, { text: `${r.name} = ${formatNumber(v)}` })}
                        onRange={(slider) => updateRow(row.id, { slider })}
                      />
                    )}
                    {r?.kind === 'error' && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">{r.message}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    className="tap-target self-start mt-1 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted"
                    aria-label={`Delete expression ${i + 1}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => addRow()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-primary border-t border-border hover:bg-muted/50"
          >
            <Plus className="w-4 h-4" /> Add expression
          </button>
        </div>

        {/* Graph */}
        <div ref={wrapRef} className="relative rounded-xl border border-border overflow-hidden bg-white h-[420px] lg:h-[560px]">
          <canvas
            ref={canvasRef}
            style={{ width: size.w, height: size.h }}
            className="block touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => { onPointerUp(); setHover(null); }}
            aria-label="Graph. Drag to move, scroll to zoom."
            role="img"
          />
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <GraphButton label="Zoom in" onClick={() => zoom(1.5)}><ZoomIn className="w-4 h-4" /></GraphButton>
            <GraphButton label="Zoom out" onClick={() => zoom(1 / 1.5)}><ZoomOut className="w-4 h-4" /></GraphButton>
            <GraphButton label="Reset view" onClick={() => setView(DEFAULT_VIEW)}><Home className="w-4 h-4" /></GraphButton>
          </div>
        </div>
      </div>

      {showKeypad && (
        <div className="grid grid-cols-8 gap-1.5 rounded-xl border border-border bg-muted/30 p-2" role="group" aria-label="Calculator keypad">
          {KEYPAD.map((k) => (
            <button
              key={k.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertText(k.insert)}
              className="h-10 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted active:scale-95 transition"
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Drag the graph to move it, scroll or use the buttons to zoom, and hover a curve to read points.
        Try <code className="px-1 rounded bg-muted font-mono">y = 2x + 1</code>, <code className="px-1 rounded bg-muted font-mono">f(x) = x^3 - 3x</code>,{' '}
        <code className="px-1 rounded bg-muted font-mono">a = 2</code> for a slider, <code className="px-1 rounded bg-muted font-mono">(3, 4)</code> for a point, or just <code className="px-1 rounded bg-muted font-mono">sqrt(2)*5</code>.
      </p>
    </div>
  );
}

function GraphButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/95 border border-slate-300 text-slate-700 shadow-sm hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

function Slider({ row, value, onChange, onRange }: {
  row: Row;
  value: number;
  onChange: (v: number) => void;
  onRange: (s: { min: number; max: number; step: number }) => void;
}) {
  const s = row.slider ?? { min: Math.min(-10, Math.floor(value)), max: Math.max(10, Math.ceil(value)), step: 0.1 };
  const edit = (key: 'min' | 'max', raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) onRange({ ...s, [key]: n });
  };
  return (
    <div className="flex items-center gap-1.5 pt-1">
      <input
        type="number"
        defaultValue={s.min}
        onBlur={(e) => edit('min', e.target.value)}
        className="w-12 rounded border border-border bg-transparent px-1 text-xs text-muted-foreground"
        aria-label="Slider minimum"
      />
      <input
        type="range"
        min={s.min}
        max={s.max}
        step={s.step}
        value={Math.min(s.max, Math.max(s.min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-primary"
        aria-label="Slider value"
      />
      <input
        type="number"
        defaultValue={s.max}
        onBlur={(e) => edit('max', e.target.value)}
        className="w-12 rounded border border-border bg-transparent px-1 text-xs text-muted-foreground"
        aria-label="Slider maximum"
      />
    </div>
  );
}

