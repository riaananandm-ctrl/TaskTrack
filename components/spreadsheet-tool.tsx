'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  SheetData, cellKey, parseCellKey, getDisplayValue, isFormula, isErrorDisplay,
} from '@/lib/spreadsheet-engine';
import { Sigma, Eraser, Download } from 'lucide-react';

const ROWS = 40;
const COLS = 12;
const STORAGE_KEY = 'tasktrack.spreadsheet.v2';

function clampCell(col: number, row: number) {
  return cellKey(Math.max(0, Math.min(COLS - 1, col)), Math.max(0, Math.min(ROWS - 1, row)));
}

function normalise(value: string): string | number | null {
  const t = value.trim();
  if (t === '') return null;
  if (t.startsWith('=')) return t;
  const n = Number(t);
  return Number.isFinite(n) && /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(t) ? n : value;
}

export function SpreadsheetTool() {
  const [data, setData] = useState<SheetData>({});
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState('A1');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) setData(parsed);
    } catch {
      // start empty
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [data, loaded]);

  const raw = (key: string) => {
    const v = data[key];
    return v == null ? '' : String(v);
  };

  const setCell = useCallback((key: string, value: string) => {
    setData((d) => {
      const next = { ...d };
      const v = normalise(value);
      if (v === null) delete next[key]; else next[key] = v;
      return next;
    });
  }, []);

  const move = useCallback((dc: number, dr: number) => {
    const p = parseCellKey(active);
    if (!p) return;
    const key = clampCell(p.col + dc, p.row + dr);
    setActive(key);
    // Keep the active cell in view.
    setTimeout(() => gridRef.current?.querySelector(`[data-cell="${key}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 0);
  }, [active]);

  const startEdit = (initial?: string) => {
    setDraft(initial ?? raw(active));
    setEditing(true);
    setTimeout(() => {
      const el = cellInputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }, 0);
  };

  const commit = (dc = 0, dr = 0) => {
    setCell(active, draft);
    setEditing(false);
    if (dc || dr) move(dc, dr);
    setTimeout(() => gridRef.current?.focus(), 0);
  };

  const cancel = () => {
    setEditing(false);
    setTimeout(() => gridRef.current?.focus(), 0);
  };

  // Keyboard on the grid (not editing).
  const onGridKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const k = e.key;
    if (k === 'ArrowUp') { e.preventDefault(); move(0, -1); }
    else if (k === 'ArrowDown') { e.preventDefault(); move(0, 1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(-1, 0); }
    else if (k === 'ArrowRight') { e.preventDefault(); move(1, 0); }
    else if (k === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); setCell(active, ''); }
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); startEdit(k); }
  };

  const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  /** Put SUM/AVERAGE/... of the numbers above the active cell into it. */
  const quick = (fn: 'SUM' | 'AVERAGE' | 'MIN' | 'MAX') => {
    const p = parseCellKey(active);
    if (!p) return;
    if (p.row === 0) { setNote('Pick an empty cell below your numbers first.'); return; }
    let top = p.row - 1;
    while (top > 0 && data[cellKey(p.col, top - 1)] != null) top--;
    const col = cellKey(p.col, 0).replace(/\d+$/, '');
    setCell(active, `=${fn}(${col}${top + 1}:${col}${p.row})`);
    setNote(null);
  };

  const exportCsv = () => {
    let lastRow = -1;
    let lastCol = -1;
    for (const key of Object.keys(data)) {
      const p = parseCellKey(key);
      if (p) { lastRow = Math.max(lastRow, p.row); lastCol = Math.max(lastCol, p.col); }
    }
    if (lastRow < 0) { setNote('Nothing to download yet.'); return; }
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines: string[] = [];
    for (let r = 0; r <= lastRow; r++) {
      const cells: string[] = [];
      for (let c = 0; c <= lastCol; c++) cells.push(esc(getDisplayValue(cellKey(c, r), data)));
      lines.push(cells.join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasktrack-sheet.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Formula bar + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs px-2 py-1.5 rounded bg-muted min-w-[52px] text-center" aria-label="Selected cell">{active}</span>
        <span className="text-sm italic text-muted-foreground select-none">fx</span>
        <input
          value={editing ? draft : raw(active)}
          onFocus={() => { if (!editing) { setDraft(raw(active)); setEditing(true); } }}
          onChange={(e) => { setDraft(e.target.value); if (!editing) setEditing(true); }}
          onKeyDown={onEditKey}
          onBlur={(e) => {
            // Leaving the bar for the in-cell editor keeps the edit going.
            if (e.relatedTarget === cellInputRef.current) return;
            if (editing) commit();
          }}
          placeholder="Type a value or a formula like =SUM(A1:A5)"
          aria-label="Formula bar"
          spellCheck={false}
          className="flex-1 min-w-[180px] h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => quick('SUM')}><Sigma className="w-3.5 h-3.5 mr-1" />SUM</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => quick('AVERAGE')}>AVG</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => quick('MIN')}>MIN</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => quick('MAX')}>MAX</Button>
          <Button type="button" variant="outline" size="sm" onClick={exportCsv}><Download className="w-3.5 h-3.5 mr-1" />CSV</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { setData({}); setActive('A1'); setEditing(false); }}>
            <Eraser className="w-3.5 h-3.5 mr-1" />Clear
          </Button>
        </div>
      </div>
      {note && <p className="text-xs text-amber-700 dark:text-amber-400">{note}</p>}

      {/* Grid */}
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKey}
        role="grid"
        aria-label="Spreadsheet. Use the arrow keys to move and start typing to edit."
        className="overflow-auto rounded-xl border border-border max-h-[60dvh] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <table className="border-collapse text-sm select-none">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-muted border border-border w-10 h-8" />
              {Array.from({ length: COLS }, (_, c) => {
                const label = cellKey(c, 0).replace(/\d+$/, '');
                const isCol = parseCellKey(active)?.col === c;
                return (
                  <th key={c} className={cn('sticky top-0 z-20 border border-border px-2 h-8 text-xs font-semibold min-w-[96px]', isCol ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, r) => {
              const isRow = parseCellKey(active)?.row === r;
              return (
                <tr key={r}>
                  <td className={cn('sticky left-0 z-10 border border-border text-center text-xs font-medium w-10 h-8', isRow ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                    {r + 1}
                  </td>
                  {Array.from({ length: COLS }, (_, c) => {
                    const key = cellKey(c, r);
                    const isActive = key === active;
                    const val = data[key];
                    const display = getDisplayValue(key, data);
                    const isNum = typeof val === 'number' || (isFormula(val) && !isErrorDisplay(display));
                    return (
                      <td
                        key={key}
                        data-cell={key}
                        role="gridcell"
                        aria-selected={isActive}
                        onMouseDown={(e) => {
                          if (editing && isActive) return;
                          e.preventDefault();
                          // Tapping the already-selected cell starts editing (handy on phones).
                          if (isActive) { startEdit(); return; }
                          if (editing) commit();
                          setActive(key);
                          gridRef.current?.focus();
                        }}
                        onDoubleClick={() => { setActive(key); startEdit(); }}
                        className={cn(
                          'relative border border-border px-2 h-8 max-w-[160px] cursor-cell',
                          isActive ? 'outline outline-2 -outline-offset-2 outline-primary bg-primary/[0.04]' : 'hover:bg-muted/40',
                        )}
                      >
                        {editing && isActive ? (
                          <input
                            ref={cellInputRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={onEditKey}
                            onBlur={(e) => {
                              if ((e.relatedTarget as HTMLElement | null)?.getAttribute('aria-label') === 'Formula bar') return;
                              commit();
                            }}
                            spellCheck={false}
                            aria-label={`Edit ${key}`}
                            className="absolute inset-0 w-full h-full px-2 bg-white dark:bg-background font-mono text-sm outline-none"
                          />
                        ) : (
                          <span className={cn(
                            'block truncate',
                            isNum && 'text-right tabular-nums',
                            isFormula(val) && !isErrorDisplay(display) && 'text-blue-700 dark:text-blue-400',
                            isErrorDisplay(display) && 'text-red-600 font-medium',
                          )}>
                            {display}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Click a cell and start typing. Enter moves down, Tab moves right, arrows move around, Delete clears.
        Formulas start with <code className="px-1 rounded bg-muted font-mono">=</code>, like <code className="px-1 rounded bg-muted font-mono">=SUM(A1:A5)</code>,{' '}
        <code className="px-1 rounded bg-muted font-mono">=AVERAGE(B1:B10)</code> or <code className="px-1 rounded bg-muted font-mono">=A1*2+B1</code>.
        Functions: SUM, AVERAGE, MIN, MAX, COUNT, MEDIAN, ROUND, ABS, SQRT, POWER, IF, plus sin, cos, ln, log. Your sheet is saved in this browser.
      </p>
    </div>
  );
}
