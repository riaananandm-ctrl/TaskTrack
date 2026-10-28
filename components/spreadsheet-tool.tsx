'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  SheetData, cellKey, getDisplayValue, isFormula,
} from '@/lib/spreadsheet-engine';
import { Plus, Minus, Sigma, Eraser, Table } from 'lucide-react';

const ROWS = 20;
const COLS = 8;

export function SpreadsheetTool() {
  const [data, setData] = useState<SheetData>({});
  const [activeCell, setActiveCell] = useState<string>('A1');
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const setCellValue = useCallback((key: string, value: string) => {
    setData((d) => {
      const next = { ...d };
      if (value === '') {
        delete next[key];
      } else {
        const num = parseFloat(value);
        next[key] = !isNaN(num) && /^-?\d+\.?\d*$/.test(value) ? num : value;
      }
      return next;
    });
  }, []);

  const startEdit = useCallback((key: string) => {
    setActiveCell(key);
    setEditing(true);
    const val = data[key];
    setEditValue(val != null ? String(val) : '');
    setTimeout(() => inputRef.current?.select(), 0);
  }, [data]);

  const commitEdit = useCallback(() => {
    setCellValue(activeCell, editValue);
    setEditing(false);
  }, [activeCell, editValue, setCellValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { setEditing(false); }
  };

  const formulaBar = useMemo(() => {
    const val = data[activeCell];
    return val != null ? String(val) : '';
  }, [data, activeCell]);

  const quickSum = useCallback((fn: 'sum' | 'avg' | 'min' | 'max') => {
    const parsed = activeCell.match(/^([A-Z]+)(\d+)$/);
    if (!parsed) return;
    const row = parseInt(parsed[2], 10);
    const col = parsed[1];
    const range = `${col}1:${col}${ROWS}`;
    const formula = `=${fn.toUpperCase()}(${range})`;
    setCellValue(activeCell, formula);
  }, [activeCell, setCellValue]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Table className="w-4 h-4" />
          <span className="font-medium text-foreground">Spreadsheet</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-mono px-2 py-1 rounded bg-muted min-w-[60px] text-center">
            {activeCell}
          </span>
          <Input
            ref={inputRef}
            value={editing ? editValue : formulaBar}
            onChange={(e) => {
              if (editing) setEditValue(e.target.value);
              else { setEditValue(e.target.value); setEditing(true); }
            }}
            onKeyDown={handleKeyDown}
            onBlur={commitEdit}
            onFocus={() => { const val = data[activeCell]; setEditValue(val != null ? String(val) : ''); }}
            placeholder="Enter a value or =SUM(A1:A5)..."
            className="flex-1 max-w-xs font-mono text-sm"
          />
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => quickSum('sum')}>
            <Sigma className="w-3.5 h-3.5 mr-1" /> SUM
          </Button>
          <Button variant="outline" size="sm" onClick={() => quickSum('avg')}>
            AVG
          </Button>
          <Button variant="outline" size="sm" onClick={() => quickSum('min')}>
            MIN
          </Button>
          <Button variant="outline" size="sm" onClick={() => quickSum('max')}>
            MAX
          </Button>
          <Button variant="outline" size="sm" onClick={() => setData({})}>
            <Eraser className="w-3.5 h-3.5 mr-1" /> Clear
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-auto rounded-xl border border-border max-h-[60vh]">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-muted border border-border w-10 h-8" />
              {Array.from({ length: COLS }, (_, c) => (
                <th
                  key={c}
                  className="sticky top-0 z-10 bg-muted border border-border px-2 h-8 text-xs font-semibold text-muted-foreground min-w-[80px]"
                >
                  {cellKey(c, 0).replace(/\d+$/, '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, r) => (
              <tr key={r}>
                <td className="sticky left-0 z-10 bg-muted border border-border text-center text-xs text-muted-foreground font-medium w-10 h-8">
                  {r + 1}
                </td>
                {Array.from({ length: COLS }, (_, c) => {
                  const key = cellKey(c, r);
                  const isActive = key === activeCell;
                  const display = getDisplayValue(key, data);
                  const val = data[key];
                  const isFormulaCell = isFormula(val);
                  return (
                    <td
                      key={key}
                      onClick={() => setActiveCell(key)}
                      onDoubleClick={() => startEdit(key)}
                      className={cn(
                        'border border-border px-2 h-8 cursor-cell transition-colors',
                        isActive ? 'ring-2 ring-primary ring-inset z-10' : 'hover:bg-muted/30',
                        isFormulaCell && 'bg-blue-50 dark:bg-blue-950/20'
                      )}
                    >
                      {editing && isActive ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onBlur={commitEdit}
                          className="w-full h-full bg-transparent outline-none font-mono text-sm"
                        />
                      ) : (
                        <span className={cn(
                          'block truncate',
                          isFormulaCell && 'text-blue-600 dark:text-blue-400 font-medium',
                          typeof val === 'number' && 'text-right tabular-nums'
                        )}>
                          {display}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Click a cell to select, double-click to edit. Use formulas like <code className="px-1 py-0.5 rounded bg-muted font-mono">=SUM(A1:A5)</code>, <code className="px-1 py-0.5 rounded bg-muted font-mono">=AVERAGE(B1:B10)</code>, or <code className="px-1 py-0.5 rounded bg-muted font-mono">=A1+B1*2</code>. Functions: SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS, SQRT, POWER.
      </p>
    </div>
  );
}
