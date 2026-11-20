'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase/client';
import { announceCreditsChanged } from '@/lib/ai-credits';
import {
  Pencil, Highlighter, Eraser, Minus, Square, Circle, Hand, Undo2, Redo2, Trash2, Download,
  Bot, Loader2, Send, Home, Lock,
} from 'lucide-react';

/**
 * Whiteboard: an infinite canvas you can draw on, pan around, undo, and save as PNG.
 * The canvas is always mounted (no "loading" gate), sized to its box with
 * ResizeObserver, and drawn at device pixel ratio so lines stay crisp.
 * Drawings are kept in this browser between visits.
 *
 * AI tutor (Premium and Max): sends a picture of the visible board with the question.
 * The tutor can answer with marks of its own (arrows, circles, labels), which are added
 * to the board as normal shapes, so Undo removes them.
 */

type ToolId = 'pen' | 'highlighter' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'pan';
type Pt = { x: number; y: number };

interface Shape {
  kind: 'free' | 'line' | 'rect' | 'ellipse' | 'text';
  points: Pt[]; // free: every point; text: [top-left]; others: [start, end]
  color: string;
  width: number; // text: font size
  alpha: number;
  text?: string;
}

/** A mark the AI tutor asks to draw, in the snapshot image's pixels. */
type TutorDrawing =
  | { type: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { type: 'circle'; cx: number; cy: number; r: number; color: string }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { type: 'path'; points: [number, number][]; color: string };

const SNAPSHOT_MAX_W = 1024;

const COLORS = ['#1e293b', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
const WIDTHS = [2, 4, 8, 14];
const STORAGE_KEY = 'tasktrack.whiteboard.v2';
const MAX_SHAPES = 2000;

const TOOLS: Array<{ id: ToolId; label: string; icon: typeof Pencil; key: string }> = [
  { id: 'pen', label: 'Pen', icon: Pencil, key: 'p' },
  { id: 'highlighter', label: 'Highlighter', icon: Highlighter, key: 'h' },
  { id: 'eraser', label: 'Eraser', icon: Eraser, key: 'e' },
  { id: 'line', label: 'Line', icon: Minus, key: 'l' },
  { id: 'rect', label: 'Rectangle', icon: Square, key: 'r' },
  { id: 'ellipse', label: 'Circle', icon: Circle, key: 'o' },
  { id: 'pan', label: 'Move', icon: Hand, key: 'm' },
];

function isShape(v: unknown): v is Shape {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    ['free', 'line', 'rect', 'ellipse', 'text'].includes(s.kind as string) &&
    (s.kind !== 'text' || typeof s.text === 'string') &&
    Array.isArray(s.points) &&
    s.points.every((p) => p && Number.isFinite((p as Pt).x) && Number.isFinite((p as Pt).y)) &&
    typeof s.color === 'string' && Number.isFinite(s.width) && Number.isFinite(s.alpha)
  );
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  if (!s.points.length) return;
  ctx.save();
  ctx.globalAlpha = s.alpha;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  if (s.kind === 'text') {
    ctx.font = `600 ${s.width}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(s.text ?? '', a.x, a.y);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  if (s.kind === 'free') {
    if (s.points.length === 1) {
      ctx.arc(a.x, a.y, s.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.moveTo(a.x, a.y);
    // Smooth the stroke with quadratic curves through midpoints.
    for (let i = 1; i < s.points.length - 1; i++) {
      const p = s.points[i];
      const n = s.points[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
    }
    ctx.lineTo(b.x, b.y);
  } else if (s.kind === 'line') {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (s.kind === 'rect') {
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else {
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/** Distance from point p to segment ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Does the eraser at p (radius r) touch this shape? */
function hits(s: Shape, p: Pt, r: number): boolean {
  const tol = r + s.width / 2;
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  if (s.kind === 'text') {
    const w = (s.text?.length ?? 0) * s.width * 0.6;
    return p.x >= a.x - r && p.x <= a.x + w + r && p.y >= a.y - r && p.y <= a.y + s.width + r;
  }
  if (s.kind === 'free') {
    if (s.points.length === 1) return Math.hypot(p.x - a.x, p.y - a.y) <= tol;
    for (let i = 1; i < s.points.length; i++) if (segDist(p, s.points[i - 1], s.points[i]) <= tol) return true;
    return false;
  }
  if (s.kind === 'line') return segDist(p, a, b) <= tol;
  if (s.kind === 'rect') {
    const c = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    return c.some((q, i) => segDist(p, q, c[(i + 1) % 4]) <= tol);
  }
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2 || 1;
  const ry = Math.abs(b.y - a.y) / 2 || 1;
  const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
  return Math.abs(k - 1) * Math.min(rx, ry) <= tol;
}

/** Turn the tutor's marks (snapshot pixels) into board shapes. */
function tutorShapes(drawings: TutorDrawing[], scale: number, offset: Pt, view: { w: number; h: number }): Shape[] {
  const P = (x: number, y: number): Pt => ({ x: x * scale - offset.x, y: y * scale - offset.y });
  const base = { width: 3, alpha: 1 };
  const out: Shape[] = [];
  for (const d of drawings) {
    if (d.type === 'line' || d.type === 'arrow') {
      const a = P(d.x1, d.y1);
      const b = P(d.x2, d.y2);
      out.push({ kind: 'line', points: [a, b], color: d.color, ...base });
      if (d.type === 'arrow') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        for (const turn of [Math.PI * 0.85, -Math.PI * 0.85]) {
          out.push({
            kind: 'line',
            points: [b, { x: b.x + 14 * Math.cos(ang + turn), y: b.y + 14 * Math.sin(ang + turn) }],
            color: d.color,
            ...base,
          });
        }
      }
    } else if (d.type === 'rect') {
      out.push({ kind: 'rect', points: [P(d.x, d.y), P(d.x + d.w, d.y + d.h)], color: d.color, ...base });
    } else if (d.type === 'circle') {
      out.push({ kind: 'ellipse', points: [P(d.cx - d.r, d.cy - d.r), P(d.cx + d.r, d.cy + d.r)], color: d.color, ...base });
    } else if (d.type === 'path') {
      out.push({ kind: 'free', points: d.points.map(([x, y]) => P(x, y)), color: d.color, ...base });
    } else if (d.type === 'text') {
      // Keep labels fully inside the visible board.
      const size = Math.round(d.size * scale);
      const p = P(d.x, d.y);
      const textW = d.text.length * size * 0.6;
      p.x = Math.min(Math.max(p.x, 4 - offset.x), view.w - textW - 4 - offset.x);
      p.y = Math.min(Math.max(p.y, 4 - offset.y), view.h - size - 4 - offset.y);
      out.push({ kind: 'text', points: [p], color: d.color, width: size, alpha: 1, text: d.text });
    }
  }
  return out;
}

export function WhiteboardTool({ tutorAllowed = false }: { tutorAllowed?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  const [tool, setTool] = useState<ToolId>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[][]>([]);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [offset, setOffset] = useState<Pt>({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);

  const drawing = useRef<Shape | null>(null);
  const panStart = useRef<{ p: Pt; offset: Pt } | null>(null);
  const erasedThisDrag = useRef(false);

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [letTutorDraw, setLetTutorDraw] = useState(true);
  const [aiNote, setAiNote] = useState<string | null>(null);

  // Load a saved board once.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) setShapes(parsed.filter(isShape).slice(-MAX_SHAPES));
    } catch {
      // Storage blocked or corrupt: start with an empty board.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shapes)); } catch { /* full or blocked */ }
    }, 300);
    return () => clearTimeout(t);
  }, [shapes, loaded]);

  // Size the canvas to its box.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(100, Math.round(r.width)), h: Math.max(100, Math.round(r.height)) });
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);
    // Dot grid that moves with the board.
    ctx.fillStyle = '#e2e8f0';
    const gap = 24;
    const ox = ((offset.x % gap) + gap) % gap;
    const oy = ((offset.y % gap) + gap) % gap;
    for (let x = ox; x < size.w; x += gap) for (let y = oy; y < size.h; y += gap) ctx.fillRect(x, y, 1.5, 1.5);
    ctx.translate(offset.x, offset.y);
    for (const s of shapes) drawShape(ctx, s);
    if (drawing.current) drawShape(ctx, drawing.current);
  }, [shapes, offset, size]);

  useEffect(() => { render(); }, [render]);

  const toBoard = (e: React.PointerEvent): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left - offset.x, y: e.clientY - r.top - offset.y };
  };

  const commit = useCallback((next: Shape[]) => {
    setHistory((h) => [...h.slice(-99), shapes]);
    setRedo([]);
    setShapes(next.slice(-MAX_SHAPES));
  }, [shapes]);

  const eraseAt = (p: Pt) => {
    const r = width * 2;
    const kept = shapes.filter((s) => !hits(s, p, r));
    if (kept.length !== shapes.length) {
      if (!erasedThisDrag.current) {
        setHistory((h) => [...h.slice(-99), shapes]);
        setRedo([]);
        erasedThisDrag.current = true;
      }
      setShapes(kept);
    }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toBoard(e);
    if (tool === 'pan' || e.button === 1) {
      panStart.current = { p: { x: e.clientX, y: e.clientY }, offset };
      return;
    }
    if (tool === 'eraser') {
      erasedThisDrag.current = false;
      eraseAt(p);
      panStart.current = null;
      drawing.current = null;
      (e.currentTarget as HTMLCanvasElement).dataset.erasing = '1';
      return;
    }
    const kind: Shape['kind'] = tool === 'line' ? 'line' : tool === 'rect' ? 'rect' : tool === 'ellipse' ? 'ellipse' : 'free';
    drawing.current = {
      kind,
      points: kind === 'free' ? [p] : [p, p],
      color,
      width: tool === 'highlighter' ? width * 4 : width,
      alpha: tool === 'highlighter' ? 0.35 : 1,
    };
    render();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panStart.current) {
      const s = panStart.current;
      setOffset({ x: s.offset.x + e.clientX - s.p.x, y: s.offset.y + e.clientY - s.p.y });
      return;
    }
    if (e.currentTarget.dataset.erasing === '1') { eraseAt(toBoard(e)); return; }
    const d = drawing.current;
    if (!d) return;
    const p = toBoard(e);
    if (d.kind === 'free') {
      const last = d.points[d.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
      d.points.push(p);
    } else {
      d.points[1] = e.shiftKey && d.kind !== 'line'
        ? { x: p.x, y: d.points[0].y + Math.sign(p.y - d.points[0].y || 1) * Math.abs(p.x - d.points[0].x) }
        : p;
    }
    render();
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    panStart.current = null;
    e.currentTarget.dataset.erasing = '';
    const d = drawing.current;
    drawing.current = null;
    if (d) commit([...shapes, d]);
  };

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setRedo((r) => [...r, shapes]);
      setShapes(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, [shapes]);

  const redoFn = useCallback(() => {
    setRedo((r) => {
      if (!r.length) return r;
      setHistory((h) => [...h, shapes]);
      setShapes(r[r.length - 1]);
      return r.slice(0, -1);
    });
  }, [shapes]);

  const clearAll = () => { if (shapes.length) commit([]); };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const a = document.createElement('a');
      a.download = 'tasktrack-whiteboard.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch {
      // Ignore: nothing to save.
    }
  };

  // Keyboard shortcuts when focus is not in a text box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoFn(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redoFn(); return; }
      if (mod) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redoFn]);

  /** A JPEG of what is visible on the board, at most 1024 px wide. */
  const snapshot = (): { image: string; width: number; height: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const outW = Math.min(SNAPSHOT_MAX_W, size.w);
    const outH = Math.round((size.h * outW) / size.w);
    const off = document.createElement('canvas');
    off.width = outW;
    off.height = outH;
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(canvas, 0, 0, outW, outH);
    try {
      return { image: off.toDataURL('image/jpeg', 0.85), width: outW, height: outH };
    } catch {
      return null;
    }
  };

  const askTutor = async () => {
    if (!aiPrompt.trim() || !tutorAllowed) return;
    setAiLoading(true);
    setAiError(null);
    setAiResponse('');
    setAiNote(null);
    try {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !base) { setAiError('Please sign in to use the AI tutor.'); return; }
      const shot = snapshot();
      if (!shot) { setAiError('Couldn’t read the board. Please try again.'); return; }
      const viewOffset = offset;
      const scale = size.w / shot.width;
      const res = await fetch(`${base}/functions/v1/whiteboard-tutor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          Apikey: anon ?? '',
        },
        body: JSON.stringify({ question: aiPrompt.trim(), image: shot.image, width: shot.width, height: shot.height }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        setAiError(data?.error || 'The AI tutor could not respond. Please try again.');
        return;
      }
      setAiResponse(String(data.reply || 'The AI tutor did not return a response.').replace(/\*\*|__/g, ''));
      const marks = Array.isArray(data.drawings) ? (data.drawings as TutorDrawing[]) : [];
      if (letTutorDraw && marks.length) {
        commit([...shapes, ...tutorShapes(marks, scale, viewOffset, size)]);
        setAiNote(`The tutor drew ${marks.length} mark${marks.length === 1 ? '' : 's'} on your board. Press Undo to remove them.`);
      }
      if (data.usage?.cost) {
        setAiNote((n) => `${n ? `${n} ` : ''}Used ${data.usage.cost} credit${data.usage.cost === 1 ? '' : 's'}.`);
      }
      announceCreditsChanged();
    } catch {
      setAiError('Could not reach the AI tutor. Please check your connection.');
    } finally {
      setAiLoading(false);
    }
  };

  const cursor = tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair';

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-border p-1" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              aria-pressed={tool === t.id}
              aria-label={`${t.label} (${t.key.toUpperCase()})`}
              title={`${t.label} (${t.key.toUpperCase()})`}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                tool === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <t.icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Colour">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setColor(c); if (tool === 'eraser' || tool === 'pan') setTool('pen'); }}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              className={cn('w-6 h-6 rounded-full border-2 transition-transform', color === c ? 'border-primary scale-110' : 'border-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)] hover:scale-105')}
              style={{ background: c }}
            />
          ))}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Size">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWidth(w)}
              aria-label={`Size ${w}`}
              aria-pressed={width === w}
              className={cn('flex items-center justify-center w-8 h-8 rounded-lg border transition-colors', width === w ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted')}
            >
              <span className="rounded-full bg-foreground" style={{ width: Math.min(w, 12), height: Math.min(w, 12) }} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <Button type="button" variant="outline" size="sm" onClick={undo} disabled={!history.length} title="Undo (Ctrl+Z)">
            <Undo2 className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Undo</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={redoFn} disabled={!redo.length} title="Redo (Ctrl+Y)">
            <Redo2 className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Redo</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOffset({ x: 0, y: 0 })} title="Back to start">
            <Home className="w-3.5 h-3.5" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={clearAll} disabled={!shapes.length}>
            <Trash2 className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Clear</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            <Download className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Save PNG</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
        <div ref={wrapRef} className="relative rounded-xl border border-border overflow-hidden bg-white h-[460px] lg:h-[560px]">
          <canvas
            ref={canvasRef}
            style={{ width: size.w, height: size.h }}
            className={cn('block touch-none', cursor)}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            aria-label="Whiteboard drawing area"
            role="img"
          />
          {loaded && shapes.length === 0 && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
              Draw here. Shift draws perfect squares and circles.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">AI Tutor</h3>
              <p className="text-xs text-muted-foreground">Sees what’s on your board and can draw on it to explain.</p>
            </div>
          </div>
          {!tutorAllowed ? (
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 text-center">
              <Lock className="mx-auto h-5 w-5 text-primary" />
              <p className="mt-2 text-sm font-semibold">Part of Premium and Max</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ask about your drawing, maths working or diagram, and the tutor circles mistakes, adds arrows and labels.
              </p>
              <Button asChild size="sm" className="mt-3">
                <a href="/app/premium">See plans</a>
              </Button>
            </div>
          ) : (
            <>
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) askTutor(); }}
                placeholder="e.g. Is my working for this equation right? or: How can I make this face look more realistic?"
                rows={3}
                className="text-sm resize-none"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={letTutorDraw}
                  onChange={(e) => setLetTutorDraw(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Let the tutor draw on my board
              </label>
              <Button type="button" onClick={askTutor} disabled={aiLoading || !aiPrompt.trim()} className="w-full" size="sm">
                {aiLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {aiLoading ? 'Looking at your board (up to 30 s)…' : 'Ask the tutor'}
              </Button>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Sends a picture of the part of the board you can see. About 2 credits a question, a little more for long
                answers.
              </p>
              {aiError && <p className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{aiError}</p>}
              {aiNote && <p className="text-xs text-muted-foreground">{aiNote}</p>}
              {aiResponse && (
                <div className="rounded-lg border border-border p-3 bg-muted/30 max-h-[300px] overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{aiResponse}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
