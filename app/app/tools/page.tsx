'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { CalculatorTool } from '@/components/calculator-tool';
import { SpreadsheetTool } from '@/components/spreadsheet-tool';
import { WhiteboardErrorBoundary } from '@/components/whiteboard-error-boundary';
import { cn } from '@/lib/utils';
import { Calculator, Table, PenTool, Gift, Wand2, ScanSearch } from 'lucide-react';
import { RedeemCodeTool } from '@/components/redeem-code-tool';
import { PolishWritingTool } from '@/components/polish-writing-tool';
import { AiDetectorTool } from '@/components/ai-detector-tool';
import { EMPTY_ACCESS, TOOL_ACCESS_EVENT, getToolAccess, type ToolAccess } from '@/lib/tool-unlocks';

type Tool = 'calculator' | 'spreadsheet' | 'whiteboard' | 'redeem' | 'polish' | 'detector';

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
const POLISH_TAB = { id: 'polish' as Tool, label: 'Polish my writing', icon: Wand2, description: 'Unlocked · Premium' };
const DETECTOR_TAB = { id: 'detector' as Tool, label: 'AI Detector', icon: ScanSearch, description: 'Unlocked · Premium' };
const REDEEM_TAB = { id: 'redeem' as Tool, label: 'Redeem Code', icon: Gift, description: 'Find codes on @task.track' };

export default function ToolsPage() {
  const [active, setActive] = useState<Tool>('calculator');
  const [whiteboardKey, setWhiteboardKey] = useState(0);

  const [access, setAccess] = useState<ToolAccess>(EMPTY_ACCESS);

  const resetWhiteboard = useCallback(() => {
    setWhiteboardKey((k) => k + 1);
  }, []);

  const loadAccess = useCallback(() => {
    getToolAccess().then(setAccess).catch(() => {});
  }, []);
  useEffect(() => {
    loadAccess();
    window.addEventListener(TOOL_ACCESS_EVENT, loadAccess);
    return () => window.removeEventListener(TOOL_ACCESS_EVENT, loadAccess);
  }, [loadAccess]);

  const tabs = [...TOOLS, ...(access.unlocked.includes('polish') ? [POLISH_TAB] : []), ...(access.unlocked.includes('detector') ? [DETECTOR_TAB] : []), REDEEM_TAB];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Study Tools</h1>
        <p className="text-sm text-muted-foreground mt-1">Calculator, spreadsheet, and whiteboard with AI tutor.</p>
      </div>

      {/* Tool tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
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
        {active === 'redeem' && (
          <RedeemCodeTool unlocked={access.unlocked} onOpenTool={(tool) => (tool === 'polish' || tool === 'detector') && setActive(tool)} />
        )}
        {active === 'polish' && <PolishWritingTool access={access} onUsed={loadAccess} />}
        {active === 'detector' && <AiDetectorTool access={access} onUsed={loadAccess} />}
        {active === 'whiteboard' && (
          <WhiteboardErrorBoundary onReset={resetWhiteboard}>
            <WhiteboardTool key={whiteboardKey} />
          </WhiteboardErrorBoundary>
        )}
      </div>
    </div>
  );
}
