'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { CalculatorTool } from '@/components/calculator-tool';
import { SpreadsheetTool } from '@/components/spreadsheet-tool';
import { WhiteboardErrorBoundary } from '@/components/whiteboard-error-boundary';
import { cn } from '@/lib/utils';
import { Calculator, Table, PenTool } from 'lucide-react';

type Tool = 'calculator' | 'spreadsheet' | 'whiteboard';

const WhiteboardTool = dynamic(
  () => import('@/components/whiteboard-tool').then((m) => m.WhiteboardTool),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading whiteboard...</p>
      </div>
    ),
  }
);

const TOOLS: Array<{ id: Tool; label: string; icon: typeof Calculator; description: string }> = [
  { id: 'calculator', label: 'Calculator', icon: Calculator, description: 'Graphing, like Desmos' },
  { id: 'spreadsheet', label: 'Spreadsheet', icon: Table, description: 'Formulas, SUM, CSV export' },
  { id: 'whiteboard', label: 'Whiteboard', icon: PenTool, description: 'Draw, shapes, AI tutor' },
];

export default function ToolsPage() {
  const [active, setActive] = useState<Tool>('calculator');
  const [whiteboardKey, setWhiteboardKey] = useState(0);

  const resetWhiteboard = useCallback(() => {
    setWhiteboardKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Study Tools</h1>
        <p className="text-sm text-muted-foreground mt-1">Calculator, spreadsheet, and whiteboard with AI tutor.</p>
      </div>

      {/* Tool tabs */}
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all',
              active === t.id
                ? 'border-primary bg-primary/5 text-primary shadow-sm'
                : 'border-border hover:border-primary/30 hover:bg-muted/50'
            )}
          >
            <t.icon className="w-5 h-5" />
            <div className="text-left">
              <p className="text-sm font-semibold">{t.label}</p>
              <p className="text-xs text-muted-foreground">{t.description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Active tool */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        {active === 'calculator' && <CalculatorTool />}
        {active === 'spreadsheet' && <SpreadsheetTool />}
        {active === 'whiteboard' && (
          <WhiteboardErrorBoundary onReset={resetWhiteboard}>
            <WhiteboardTool key={whiteboardKey} />
          </WhiteboardErrorBoundary>
        )}
      </div>
    </div>
  );
}
