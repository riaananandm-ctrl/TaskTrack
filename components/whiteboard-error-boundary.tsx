'use client';

import { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RotateCcw, ArrowLeft } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
}

export class WhiteboardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Log only the safe technical message — no user data, tokens, or private content.
    console.error('Whiteboard error:', error?.message ?? 'Unknown error');
  }

  handleReset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-4">
          <div className="w-14 h-14 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold">The whiteboard could not load.</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              Your other tools and pages are unaffected. Try again or go back to Study Sessions.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={this.handleReset}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Try again
            </Button>
            <a href="/app/study-sessions">
              <Button size="sm">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to Study Sessions
              </Button>
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
