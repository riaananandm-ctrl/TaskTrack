'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

/** Optional focus timer sized to the task's estimated duration. */
export function CountdownTimer({ minutes }: { minutes: number }) {
  const total = Math.max(1, minutes) * 60;
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setRemaining(total);
    setRunning(false);
  }, [total]);

  useEffect(() => {
    if (!running || remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, remaining]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const done = remaining === 0;

  return (
    <button
      type="button"
      onClick={() => setRunning((r) => !r)}
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      title={done ? 'Focus time finished' : running ? 'Pause focus timer' : 'Start focus timer'}
    >
      <Clock className="w-3 h-3" />
      <span className={done ? 'text-green-600 font-medium' : ''}>
        {done ? 'Focus time done' : `${mm}:${ss}${running ? '' : ' — paused'}`}
      </span>
    </button>
  );
}
