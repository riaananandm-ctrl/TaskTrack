'use client';

import { useState, useCallback, useEffect } from 'react';
import { evaluateExpression, formatResult } from '@/lib/calc-engine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Delete, Calculator as CalcIcon } from 'lucide-react';

type Mode = 'basic' | 'scientific';

const BASIC_BUTTONS: Array<{ label: string; insert: string; className?: string }> = [
  { label: 'C', insert: 'clear', className: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' },
  { label: '⌫', insert: 'back', className: 'bg-muted' },
  { label: '%', insert: '%' },
  { label: '÷', insert: '/' },
  { label: '7', insert: '7' },
  { label: '8', insert: '8' },
  { label: '9', insert: '9' },
  { label: '×', insert: '*' },
  { label: '4', insert: '4' },
  { label: '5', insert: '5' },
  { label: '6', insert: '6' },
  { label: '−', insert: '-' },
  { label: '1', insert: '1' },
  { label: '2', insert: '2' },
  { label: '3', insert: '3' },
  { label: '+', insert: '+' },
  { label: '0', insert: '0' },
  { label: '.', insert: '.' },
  { label: '=', insert: '=', className: 'bg-primary text-primary-foreground' },
];

const SCI_ROW1: Array<{ label: string; insert: string }> = [
  { label: 'sin', insert: 'sin(' },
  { label: 'cos', insert: 'cos(' },
  { label: 'tan', insert: 'tan(' },
  { label: 'π', insert: 'pi' },
  { label: 'e', insert: 'e' },
];
const SCI_ROW2: Array<{ label: string; insert: string }> = [
  { label: 'ln', insert: 'ln(' },
  { label: 'log', insert: 'log(' },
  { label: '√', insert: 'sqrt(' },
  { label: 'x²', insert: '^2' },
  { label: 'xʸ', insert: '^' },
];
const SCI_ROW3: Array<{ label: string; insert: string }> = [
  { label: '(', insert: '(' },
  { label: ')', insert: ')' },
  { label: 'n!', insert: '!' },
  { label: '1/x', insert: '^(-1)' },
  { label: 'EXP', insert: 'e' },
];

export function CalculatorTool() {
  const [mode, setMode] = useState<Mode>('basic');
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState('0');
  const [error, setError] = useState(false);
  const [history, setHistory] = useState<Array<{ expr: string; result: string }>>([]);

  const compute = useCallback((raw: string) => {
    if (!raw.trim()) { setResult('0'); setError(false); return; }
    try {
      const val = evaluateExpression(raw);
      const formatted = formatResult(val);
      if (formatted === 'Error' || formatted === 'NaN' || formatted === 'Infinity' || formatted === '-Infinity') {
        setResult('Error'); setError(true);
      } else {
        setResult(formatted); setError(false);
      }
    } catch {
      setResult(''); setError(false);
    }
  }, []);

  useEffect(() => { compute(expr); }, [expr, compute]);

  const handleButton = (insert: string) => {
    if (insert === 'clear') { setExpr(''); setResult('0'); setError(false); return; }
    if (insert === 'back') { setExpr((e) => e.slice(0, -1)); return; }
    if (insert === '=') {
      if (!expr.trim() || error) return;
      const finalResult = result;
      setHistory((h) => [{ expr, result: finalResult }, ...h].slice(0, 20));
      setExpr(finalResult);
      return;
    }
    setExpr((e) => e + insert);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleButton('='); }
  };

  return (
    <div className="max-w-md mx-auto space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'basic' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('basic')}
        >
          Basic
        </Button>
        <Button
          variant={mode === 'scientific' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('scientific')}
        >
          Scientific
        </Button>
      </div>

      {/* Display */}
      <div className="rounded-2xl border border-border bg-slate-900 dark:bg-black p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <CalcIcon className="w-3.5 h-3.5" />
          {mode === 'scientific' ? 'Scientific' : 'Basic'} Calculator
        </div>
        <Input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter expression..."
          className={cn(
            'bg-transparent border-0 text-right text-lg font-mono text-white focus-visible:ring-0 focus-visible:ring-offset-0',
            error && 'text-red-400'
          )}
          autoComplete="off"
        />
        <div className={cn(
          'text-right text-3xl font-mono font-bold tabular-nums',
          error ? 'text-red-400' : 'text-emerald-400'
        )}>
          {result || '0'}
        </div>
      </div>

      {/* Scientific buttons */}
      {mode === 'scientific' && (
        <div className="space-y-1.5">
          <SciRow buttons={SCI_ROW1} onButton={handleButton} />
          <SciRow buttons={SCI_ROW2} onButton={handleButton} />
          <SciRow buttons={SCI_ROW3} onButton={handleButton} />
        </div>
      )}

      {/* Basic pad */}
      <div className="grid grid-cols-4 gap-1.5">
        {BASIC_BUTTONS.map((btn) => (
          <Button
            key={btn.label}
            variant="outline"
            className={cn(
              'h-14 text-lg font-semibold rounded-xl',
              btn.className,
              btn.label === '=' && 'col-span-2'
            )}
            onClick={() => handleButton(btn.insert)}
          >
            {btn.label}
          </Button>
        ))}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">History</span>
            <Button variant="ghost" size="sm" onClick={() => setHistory([])}>
              <Delete className="w-3.5 h-3.5 mr-1" /> Clear
            </Button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => setExpr(h.result)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm font-mono"
              >
                <span className="text-muted-foreground truncate">{h.expr}</span>
                <span className="text-foreground font-bold ml-2">= {h.result}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SciRow({ buttons, onButton }: { buttons: Array<{ label: string; insert: string }>; onButton: (v: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {buttons.map((btn) => (
        <Button
          key={btn.label}
          variant="outline"
          className="h-12 text-sm font-medium rounded-lg bg-blue-50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-950/40"
          onClick={() => onButton(btn.insert)}
        >
          {btn.label}
        </Button>
      ))}
    </div>
  );
}
