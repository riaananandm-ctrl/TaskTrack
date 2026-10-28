'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase/client';
import {
  Pencil, Eraser, Trash2, Download, Bot, Loader2, Send, Hand, Undo2, Redo2,
} from 'lucide-react';

type Tool = 'pen' | 'eraser' | 'hand';

interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  tool: Tool;
}

const COLORS = ['#1e293b', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const WIDTHS = [2, 4, 8, 16];

const MAX_CANVAS_DIM = 4096;

function safeSanitizeStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is Stroke => {
    if (!s || typeof s !== 'object') return false;
    const obj = s as Record<string, unknown>;
    if (!Array.isArray(obj.points)) return false;
    if (typeof obj.color !== 'string') return false;
    if (typeof obj.width !== 'number' || !isFinite(obj.width)) return false;
    if (typeof obj.tool !== 'string') return false;
    return obj.points.every(
      (p) => p && typeof p === 'object' &&
        typeof (p as Record<string, unknown>).x === 'number' &&
        typeof (p as Record<string, unknown>).y === 'number' &&
        isFinite((p as Record<string, unknown>).x as number) &&
        isFinite((p as Record<string, unknown>).y as number)
    );
  });
}

export function WhiteboardTool() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentStroke = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);
  const strokesRef = useRef<Stroke[]>([]);
  const redoStackRef = useRef<Stroke[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Keep ref in sync for use in event handlers without stale closures.
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { redoStackRef.current = redoStack; }, [redoStack]);

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (!stroke.points || stroke.points.length < 1) return;
    ctx.beginPath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
    ctx.lineWidth = stroke.tool === 'eraser' ? stroke.width * 3 : stroke.width;
    const p0 = stroke.points[0];
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke);
    }
  }, [drawStroke]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const w = Math.min(Math.max(1, Math.round(rect.width)), MAX_CANVAS_DIM);
    const h = Math.min(Math.max(400, Math.round(rect.height)), MAX_CANVAS_DIM);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    redraw();
  }, [redraw]);

  // Initialize canvas after mount + handle resize via ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Wait one frame for layout to settle so the container has real dimensions.
    const initFrame = requestAnimationFrame(() => {
      resizeCanvas();
      setReady(true);
    });

    // Use ResizeObserver if available, fall back to window resize.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        resizeCanvas();
      });
      ro.observe(container);
      resizeObserverRef.current = ro;
    } else {
      const onResize = () => resizeCanvas();
      window.addEventListener('resize', onResize);
      return () => {
        cancelAnimationFrame(initFrame);
        window.removeEventListener('resize', onResize);
      };
    }

    return () => {
      cancelAnimationFrame(initFrame);
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [resizeCanvas]);

  // Redraw whenever strokes change (but only after initial ready).
  useEffect(() => {
    if (!ready) return;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      redraw();
      animationFrameRef.current = null;
    });
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [strokes, ready, redraw]);

  const getPos = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      x: isFinite(x) ? x : 0,
      y: isFinite(y) ? y : 0,
    };
  }, []);

  const startDraw = useCallback((e: React.PointerEvent) => {
    if (tool === 'hand') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointerId may be invalid */ }
    drawingRef.current = true;
    setRedoStack([]);
    currentStroke.current = {
      points: [getPos(e)],
      color, width, tool,
    };
  }, [tool, color, width, getPos]);

  const moveDraw = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current || !currentStroke.current) return;
    e.preventDefault();
    const pos = getPos(e);
    currentStroke.current.points.push(pos);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pts = currentStroke.current.points;
    if (pts.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.lineWidth = tool === 'eraser' ? width * 3 : width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
  }, [tool, color, width, getPos]);

  const endDraw = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentStroke.current && currentStroke.current.points.length > 0) {
      setStrokes((s) => [...s, currentStroke.current!]);
    }
    currentStroke.current = null;
  }, []);

  const undo = useCallback(() => {
    setStrokes((s) => {
      if (!s.length) return s;
      setRedoStack((r) => [...r, s[s.length - 1]]);
      return s.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      const last = r[r.length - 1];
      setStrokes((s) => [...s, last]);
      return r.slice(0, -1);
    });
  }, []);

  const clearAll = useCallback(() => {
    setStrokes([]);
    setRedoStack([]);
  }, []);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || strokesRef.current.length === 0) return;
    try {
      const link = document.createElement('a');
      link.download = 'whiteboard.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      // toDataURL can fail if canvas is tainted or empty — no-op.
    }
  }, []);

  const handleAiAsk = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiResponse('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAiError('Please sign in to use the AI tutor.');
        setAiLoading(false);
        return;
      }

      const res = await fetch('/api/study-session/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          mode: 'chat',
          messages: [
            {
              role: 'user',
              content: `I'm using a whiteboard and I drew something. Here's what I want to know: ${aiPrompt}\n\nPlease explain it clearly as if you're a teacher standing next to me. If I asked "what is this?", describe what it might be and explain the concept. Use simple language and give an example if helpful.`,
            },
          ],
          task: null,
        }),
      });

      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (!data.ok) {
        setAiError(data.error?.message || 'The AI tutor could not respond. Please try again.');
      } else {
        setAiResponse(data.text || 'The AI tutor did not return a response.');
      }
    } catch {
      setAiError('Could not reach the AI tutor. Please check your connection.');
    }
    setAiLoading(false);
  }, [aiPrompt]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Loading whiteboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {saveError && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="font-medium hover:underline">Dismiss</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <ToolBtn active={tool === 'pen'} onClick={() => setTool('pen')} icon={Pencil} label="Pen" />
          <ToolBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} icon={Eraser} label="Eraser" />
          <ToolBtn active={tool === 'hand'} onClick={() => setTool('hand')} icon={Hand} label="Pan" />
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Colors */}
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); setTool('pen'); }}
              className={cn(
                'w-7 h-7 rounded-full border-2 transition-transform',
                color === c ? 'border-primary scale-110 ring-2 ring-primary/30' : 'border-border hover:scale-105'
              )}
              style={{ background: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Brush width */}
        <div className="flex items-center gap-1">
          {WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => setWidth(w)}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-lg border-2 transition-colors',
                width === w ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
              )}
              aria-label={`Brush size ${w}`}
            >
              <span className="rounded-full bg-foreground" style={{ width: w, height: w }} />
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-border" />

        <Button variant="outline" size="sm" onClick={undo} disabled={!strokes.length}>
          <Undo2 className="w-3.5 h-3.5 mr-1" /> Undo
        </Button>
        <Button variant="outline" size="sm" onClick={redo} disabled={!redoStack.length}>
          <Redo2 className="w-3.5 h-3.5 mr-1" /> Redo
        </Button>
        <Button variant="outline" size="sm" onClick={clearAll} disabled={!strokes.length}>
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear
        </Button>
        <Button variant="outline" size="sm" onClick={download} disabled={!strokes.length}>
          <Download className="w-3.5 h-3.5 mr-1" /> Save
        </Button>
      </div>

      {/* Canvas + AI panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        {/* Canvas */}
        <div ref={containerRef} className="relative rounded-xl border border-border overflow-hidden bg-white min-h-[400px]">
          <canvas
            ref={canvasRef}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            className={cn(
              'absolute inset-0 touch-none',
              tool === 'pen' && 'cursor-crosshair',
              tool === 'eraser' && 'cursor-cell',
              tool === 'hand' && 'cursor-grab'
            )}
          />
          {strokes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-sm text-muted-foreground">Draw something here, then ask the AI tutor about it.</p>
            </div>
          )}
        </div>

        {/* AI Tutor panel */}
        <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">AI Tutor</h3>
              <p className="text-xs text-muted-foreground">Ask about your drawing</p>
            </div>
          </div>

          <div className="space-y-2">
            <Textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. What is the water cycle? Can you explain it with more detail?"
              rows={3}
              className="text-sm resize-none"
            />
            <Button
              onClick={handleAiAsk}
              disabled={aiLoading || !aiPrompt.trim()}
              className="w-full"
              size="sm"
            >
              {aiLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {aiLoading ? 'Thinking...' : 'Ask the tutor'}
            </Button>
          </div>

          {aiError && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {aiError}
            </div>
          )}

          {aiResponse && (
            <div className="rounded-lg border border-border p-3 bg-muted/30 max-h-[300px] overflow-y-auto">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{aiResponse}</p>
            </div>
          )}

          <div className="text-xs text-muted-foreground border-t border-border pt-2">
            <p className="font-medium mb-1">Try asking:</p>
            <ul className="space-y-0.5">
              <li>&ldquo;What is photosynthesis?&rdquo;</li>
              <li>&ldquo;Explain the Pythagorean theorem&rdquo;</li>
              <li>&ldquo;How does a cell divide?&rdquo;</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: typeof Pencil;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
      )}
      aria-label={label}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
