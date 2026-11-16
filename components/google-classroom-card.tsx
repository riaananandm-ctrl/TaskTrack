'use client';

import { useCallback, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { GraduationCap, Loader2, RefreshCw, Unplug, CheckCircle2, AlertCircle, Info, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  getClassroomStatus, startClassroomConnect, syncClassroom, disconnectClassroom, RETURN_MESSAGES,
  type ClassroomStatus,
} from '@/lib/google-classroom';

type Feedback = { kind: 'ok' | 'error' | 'info'; text: string } | null;

function when(at: string | null): string {
  if (!at) return 'Not synced yet';
  try {
    return format(parseISO(at), 'd MMM yyyy, HH:mm');
  } catch {
    return 'Not synced yet';
  }
}

export function GoogleClassroomCard() {
  const [status, setStatus] = useState<ClassroomStatus | null>(null);
  const [busy, setBusy] = useState<null | 'connecting' | 'syncing' | 'disconnecting'>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = useCallback(async () => setStatus(await getClassroomStatus()), []);

  useEffect(() => {
    refresh();
    // Google sends the student back here with ?classroom=<result>.
    const params = new URLSearchParams(window.location.search);
    const result = params.get('classroom');
    if (result) {
      setFeedback(RETURN_MESSAGES[result] ?? RETURN_MESSAGES.failed);
      params.delete('classroom');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, [refresh]);

  const connect = async () => {
    setBusy('connecting');
    setFeedback(null);
    const error = await startClassroomConnect();
    if (error) {
      setFeedback({ kind: 'error', text: error });
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('syncing');
    setFeedback(null);
    const r = await syncClassroom();
    await refresh();
    setBusy(null);
    if (!r.ok) {
      setFeedback({ kind: 'error', text: r.error ?? 'Google Classroom could not be synced.' });
      return;
    }
    const parts = [
      r.imported ? `${r.imported} new` : '',
      r.updated ? `${r.updated} updated` : '',
      r.completed ? `${r.completed} marked done` : '',
    ].filter(Boolean);
    setFeedback({
      kind: parts.length ? 'ok' : 'info',
      text: parts.length ? `Synced: ${parts.join(', ')}.` : 'Google Classroom is up to date. No new assignments.',
    });
  };

  const disconnect = async () => {
    setBusy('disconnecting');
    const r = await disconnectClassroom();
    await refresh();
    setBusy(null);
    setConfirmOpen(false);
    setFeedback(
      r.ok
        ? { kind: 'info', text: 'Google Classroom disconnected and TaskTrack’s access was removed. Imported tasks are kept.' }
        : { kind: 'error', text: r.error ?? 'Google Classroom could not be disconnected.' }
    );
  };

  const connected = Boolean(status?.connected);
  const needsReconnect = Boolean(status?.needsReconnect);

  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-green-50 dark:bg-green-950/30 flex items-center justify-center flex-shrink-0">
          <GraduationCap className="w-6 h-6 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2 className="text-lg font-semibold">Google Classroom</h2>
            {connected && !needsReconnect && (
              <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100">Connected</Badge>
            )}
            {needsReconnect && <Badge variant="destructive" className="text-xs">Reconnect needed</Badge>}
            <Badge variant="secondary" className="text-xs">Beta</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Import Classroom assignments with due dates as tasks. TaskTrack checks for new work every
            30 minutes and ticks a task off when you turn it in on Classroom.
          </p>

          {status === null ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : !connected || needsReconnect ? (
            <>
              <Button size="sm" onClick={connect} disabled={busy !== null}>
                {busy === 'connecting' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <GraduationCap className="w-3.5 h-3.5 mr-1" />}
                {needsReconnect ? 'Reconnect Google Classroom' : 'Connect Google Classroom'}
              </Button>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground mt-3">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                Read-only: TaskTrack can see your classes and your own assignments, never change them.
                School accounts may need your school&rsquo;s IT admin to allow TaskTrack first.
              </p>
            </>
          ) : (
            <>
              <div className="text-xs text-muted-foreground space-y-0.5 mb-3">
                {status.googleEmail && <p>Account: {status.googleEmail}</p>}
                <p>Last sync: {when(status.lastSyncAt)}</p>
                {status.lastSyncStatus === 'error' && status.lastSyncError && (
                  <p className="text-destructive">{status.lastSyncError}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={sync} disabled={busy !== null}>
                  {busy === 'syncing' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                  Sync now
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)} disabled={busy !== null}>
                  <Unplug className="w-3.5 h-3.5 mr-1" /> Disconnect
                </Button>
              </div>
            </>
          )}

          {feedback && (
            <p
              role="status"
              className={`flex items-start gap-1.5 text-sm mt-3 ${
                feedback.kind === 'error' ? 'text-destructive' : feedback.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'
              }`}
            >
              {feedback.kind === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : feedback.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {feedback.text}
            </p>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Classroom?</AlertDialogTitle>
            <AlertDialogDescription>
              TaskTrack stops importing from Classroom and removes its access to your Google account.
              Tasks already imported stay in your list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect}>
              {busy === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
