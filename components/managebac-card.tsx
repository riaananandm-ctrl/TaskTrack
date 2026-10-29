'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  BookOpen, ChevronDown, RefreshCw, Loader2, CheckCircle2, AlertCircle, Info,
  Trash2, Link2, CalendarDays, ListTodo, EyeOff, Unplug, ShieldCheck,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  getManageBacStatus, connectManageBac, verifyManageBacFeed, syncManageBac, disconnectManageBac,
  deleteManageBacConnection, listManageBacEvents, setEventDisposition,
  listSyncChanges, markSyncChangeRead, markAllSyncChangesRead,
  MANAGEBAC_SOURCE_LABEL,
  type ManageBacStatus, type ManageBacEvent, type EventDisposition, type SyncChange,
} from '@/lib/managebac';
import { normalizeFeedUrl, maskFeedUrl, FEED_COPY } from '@/lib/feed-url';

const SETUP_STEPS = [
  'Open ManageBac and sign in.',
  'Open your student dashboard or workspace.',
  'Open the Calendar.',
  'Open \u201cMy Full Calendar\u201d or \u201cView All.\u201d',
  'Click \u201cSubscribe to Calendar.\u201d',
  'Choose the option to copy the iCalendar/calendar subscription link.',
  'Return to TaskTrack.',
  'Paste the calendar subscription link into the secure connection field.',
  'Click \u201cConnect Calendar.\u201d',
  'Click \u201cSync now\u201d to import the first events.',
];

const DETAILS_NOTE =
  'ManageBac calendar subscriptions usually provide deadlines and calendar events. They may not include full assignment instructions, teacher comments, category, priority, or estimated duration.';

const SPARSE_NOTE =
  'Some assignment details were not included in the ManageBac calendar feed.';

const PENDING_NOTE = 'ManageBac calendar updates may take a few minutes to appear.';

const MUTED = 'text-muted-foreground';

function relativeSync(at: string | null): string {
  if (!at) return 'Not synced yet';
  try {
    return format(parseISO(at), 'd MMM yyyy, HH:mm');
  } catch {
    return 'Not synced yet';
  }
}

export function ManageBacCard() {
  const [status, setStatus] = useState<ManageBacStatus | null>(null);
  const [events, setEvents] = useState<ManageBacEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSteps, setShowSteps] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const [converted, setConverted] = useState(false);
  const [alreadyHttps, setAlreadyHttps] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [convertFeedback, setConvertFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [verified, setVerified] = useState<{ url: string; empty: boolean } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState<null | 'connecting' | 'syncing' | 'disconnecting' | 'deleting'>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [eventBusy, setEventBusy] = useState<string | null>(null);
  const [changes, setChanges] = useState<SyncChange[]>([]);
  const [changesOpen, setChangesOpen] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getManageBacStatus();
    setStatus(next);
    if (next.connected) {
      setEvents(await listManageBacEvents());
      setChanges(await listSyncChanges());
    } else {
      setEvents([]);
      setChanges([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleFeedChange = (value: string) => {
    setFeedUrl(value);
    // Any edit invalidates the previous conversion and verification: the server
    // re-checks on Connect, never trusting a browser-side flag.
    setConvertedUrl(null);
    setConvertFeedback(null);
    setVerified(null);
    setVerifyFeedback(null);
    setConverted(false);
    setAlreadyHttps(false);
    setPreviewUrl(null);
  };

  const describeNormalizeError = (reason: 'empty' | 'protocol' | 'invalid') =>
    reason === 'empty'
      ? 'Paste your ManageBac calendar subscription link first.'
      : reason === 'protocol'
        ? 'That link starts with an unsupported format. Please paste the webcal:// or https:// subscription link from ManageBac.'
        : 'That does not look like a valid link. Paste the full calendar subscription link from ManageBac.';

  const handleConvert = () => {
    const normalized = normalizeFeedUrl(feedUrl);
    if (!normalized.ok) {
      setConvertFeedback({ kind: 'error', text: describeNormalizeError(normalized.reason) });
      setConvertedUrl(null);
      setVerified(null);
      setVerifyFeedback(null);
      setConverted(false);
      setAlreadyHttps(false);
      setPreviewUrl(null);
      return;
    }
    // Conversion only fixes the format. Reachability is checked separately in
    // Step 2, so a converted link is never described as accessible here.
    setConvertedUrl(normalized.url);
    setConverted(normalized.converted);
    setAlreadyHttps(!normalized.converted);
    setPreviewUrl(maskFeedUrl(normalized.url));
    setConvertFeedback({ kind: 'ok', text: 'Your link is ready for TaskTrack.' });
  };

  const verifyUrl = useCallback(async (url: string, wasConverted: boolean) => {
    setVerifying(true);
    setVerifyFeedback({ kind: 'info', text: 'Verifying…' });
    const result = await verifyManageBacFeed(url);
    setVerifying(false);

    if (!result.ok) {
      setVerified(null);
      setVerifyFeedback({
        kind: 'error',
        text: wasConverted
          ? `${FEED_COPY.convertedButUnreachable}${result.error ? ` ${result.error}` : ''}`
          : result.error ?? 'The calendar could not be verified. Please try again.',
      });
      return;
    }
    setVerified({ url, empty: Boolean(result.empty) });
    setVerifyFeedback({
      kind: 'ok',
      text: result.empty
        ? 'Calendar verified. No events found in this feed right now.'
        : 'Calendar verified. Ready to connect.',
    });
  }, []);

  // Step 2 receives the converted URL automatically and verifies it right away:
  // no copying or pasting again.
  useEffect(() => {
    if (convertedUrl) verifyUrl(convertedUrl, converted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertedUrl]);

  const handleConnect = async () => {
    if (!convertedUrl) {
      setFeedback({ kind: 'error', text: 'Convert your link first, then connect after verification succeeds.' });
      return;
    }
    setBusy('connecting');
    setFeedback(null);
    // The server normalizes and validates the link again on Connect; the earlier
    // verification is only a UX step and is never trusted here.
    const result = await connectManageBac(convertedUrl);
    if (!result.ok) {
      setFeedback({ kind: 'error', text: result.error ?? 'Your ManageBac calendar could not be connected.' });
      setBusy(null);
      return;
    }
    // The link is never shown again and is cleared from the field immediately.
    setFeedUrl('');
    setConvertedUrl(null);
    setConvertFeedback(null);
    setVerified(null);
    setVerifyFeedback(null);
    setConverted(false);
    await refresh();
    setFeedback({ kind: 'ok', text: 'ManageBac Calendar connected. Press Sync now to import your first events.' });
    setBusy(null);
  };

  const handleSync = async () => {
    setBusy('syncing');
    setFeedback(null);
    const result = await syncManageBac();
    if (!result.ok) {
      setFeedback({ kind: 'error', text: result.error ?? 'Your ManageBac calendar could not be synced.' });
      await refresh();
      setBusy(null);
      return;
    }
    await refresh();
    setSparse(Boolean(result.sparse));
    const total = (result.imported ?? 0) + (result.updated ?? 0);
    const changeNote = result.changesDetected
      ? ` ${result.changesDetected} change${result.changesDetected === 1 ? '' : 's'} recorded in “What changed” below.`
      : '';
    setFeedback({
      kind: total > 0 ? 'ok' : 'info',
      text:
        total > 0
          ? `Synced ${result.imported ?? 0} new and ${result.updated ?? 0} updated entr${total === 1 ? 'y' : 'ies'}.${changeNote}`
          : result.changesDetected
            ? `Your calendar is up to date.${changeNote}`
            : 'Your ManageBac calendar is up to date. No new entries.',
    });
    setBusy(null);
  };

  const handleDisconnect = async () => {
    setBusy('disconnecting');
    const result = await disconnectManageBac();
    await refresh();
    setBusy(null);
    setDisconnectOpen(false);
    setFeedback({
      kind: result.ok ? 'info' : 'error',
      text: result.ok
        ? 'ManageBac Calendar disconnected. No further syncs will run. Tasks already imported are kept.'
        : result.error ?? 'Your ManageBac calendar could not be disconnected.',
    });
  };

  const handleDelete = async () => {
    setBusy('deleting');
    const result = await deleteManageBacConnection();
    await refresh();
    setBusy(null);
    setDeleteOpen(false);
    setFeedback({
      kind: result.ok ? 'info' : 'error',
      text: result.ok
        ? 'Saved ManageBac connection deleted. Tasks already imported are kept.'
        : result.error ?? 'The saved connection could not be deleted.',
    });
  };

  const handleDisposition = async (event: ManageBacEvent, disposition: EventDisposition) => {
    setEventBusy(event.external_uid);
    const result = await setEventDisposition(event.external_uid, disposition);
    await refresh();
    setEventBusy(null);
    if (!result.ok) {
      setFeedback({ kind: 'error', text: result.error ?? 'That change could not be applied.' });
    }
  };

  const handleMarkRead = async (id: string) => {
    await markSyncChangeRead(id);
    setChanges((prev) => prev.map((c) => (c.id === id ? { ...c, is_read: true } : c)));
  };

  const handleMarkAllRead = async () => {
    await markAllSyncChangesRead();
    setChanges((prev) => prev.map((c) => ({ ...c, is_read: true })));
  };

  const unreadChanges = changes.filter((c) => !c.is_read).length;

  const changeSummary = (change: SyncChange): string => {
    if (change.change_kind === 'new') return 'New entry appeared in your calendar feed.';
    const fields = change.changes.map((c) => c.label).join(', ');
    return fields ? `Changed: ${fields}.` : 'Content changed in your calendar feed.';
  };

  const formatChangeValue = (value: string | null): string => {
    if (!value) return '—';
    // Due/start/end arrive as ISO instants from the feed; show the date and time part.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      try {
        const parsed = parseISO(value);
        return /\d{2}:\d{2}:\d{2}/.test(value) ? format(parsed, 'd MMM yyyy, HH:mm') : format(parsed, 'd MMM yyyy');
      } catch {
        return value;
      }
    }
    return value;
  };

  const connected = status?.connected ?? false;
  const lastError = status?.lastSyncStatus === 'error' ? status?.lastSyncError : null;

  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-6 h-6 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2 className="text-lg font-semibold">ManageBac Calendar</h2>
            {connected ? (
              <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100">
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">Not connected</Badge>
            )}
          </div>
          <p className={cn('text-sm', MUTED, 'mb-4')}>
            Connect your ManageBac calendar to import deadlines and events into TaskTrack.
            This is a one-way calendar sync from ManageBac to TaskTrack.
          </p>

          {loading ? (
            <div className={cn('flex items-center gap-2 text-sm', MUTED)}>
              <Loader2 className="w-4 h-4 animate-spin" /> Checking connection…
            </div>
          ) : (
            <div className="space-y-4">
              {/* How to connect */}
              <button
                type="button"
                onClick={() => setShowSteps((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ChevronDown className={cn('w-4 h-4 transition-transform', showSteps && 'rotate-180')} />
                How to connect
              </button>

              {showSteps && (
                <div className="rounded-lg border border-border bg-muted/40 p-4 animate-fade-in">
                  <ol className="list-decimal list-inside space-y-1.5 text-sm">
                    {SETUP_STEPS.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  <div className="flex items-start gap-2 mt-3 pt-3 border-t border-border">
                    <Info className={cn('w-4 h-4 flex-shrink-0 mt-0.5', MUTED)} />
                    <p className={cn('text-xs', MUTED)}>{DETAILS_NOTE}</p>
                  </div>
                </div>
              )}

              {/* Feedback */}
              {feedback && (
                <div
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
                    feedback.kind === 'ok'
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : feedback.kind === 'error'
                        ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                        : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  )}
                >
                  {feedback.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    : feedback.kind === 'error' ? <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      : <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  <span>{feedback.text}</span>
                </div>
              )}

              {/* Last sync error surfaced from the server */}
              {lastError && feedback?.text !== lastError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{lastError}</span>
                </div>
              )}

              {/* Connect form */}
              {!connected && (
                <div className="space-y-2">
                  <Label htmlFor="managebac-feed">Step 1 &middot; Make your calendar link compatible</Label>
                  <p className={cn('text-xs', MUTED)}>Paste your ManageBac calendar subscription link.</p>
                  <Input
                    id="managebac-feed"
                    value={feedUrl}
                    onChange={(e) => handleFeedChange(e.target.value)}
                    placeholder="Paste your ManageBac iCalendar link"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="flex items-start gap-2">
                    <ShieldCheck className={cn('w-3.5 h-3.5 flex-shrink-0 mt-0.5', MUTED)} />
                    <p className={cn('text-xs', MUTED)}>{FEED_COPY.below}</p>
                  </div>
                  {converted && (
                    <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-3 py-2 text-xs">
                      <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>{FEED_COPY.converted}</span>
                    </div>
                  )}
                  {alreadyHttps && (
                    <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-3 py-2 text-xs">
                      <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>{FEED_COPY.alreadyHttps}</span>
                    </div>
                  )}
                  {convertFeedback && (
                    <div
                      className={cn(
                        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
                        convertFeedback.kind === 'ok'
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                          : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                      )}
                    >
                      {convertFeedback.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                      <span>{convertFeedback.text}</span>
                    </div>
                  )}
                  {previewUrl && (
                    <p className="text-xs font-mono break-all text-muted-foreground" aria-label="Masked link preview">
                      {previewUrl}
                    </p>
                  )}
                  {verifyFeedback && (
                    <div
                      className={cn(
                        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
                        verifyFeedback.kind === 'ok'
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                          : verifyFeedback.kind === 'error'
                            ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                            : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                      )}
                    >
                      {verifyFeedback.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        : verifyFeedback.kind === 'error' ? <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          : <Loader2 className="w-4 h-4 flex-shrink-0 mt-0.5 animate-spin" />}
                      <span>{verifyFeedback.text}</span>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 mt-1">
                    <div className="space-y-1.5">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                        Step 2 &middot; Make link compatible
                      </p>
                      <Button onClick={handleConvert} disabled={verifying || busy !== null} size="sm" variant="outline" className="w-full">
                        {verifying ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
                        Convert link
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                        Step 3 &middot; Verify &amp; connect
                      </p>
                      <Button onClick={handleConnect} disabled={busy !== null || verifying || !verified} size="sm" className="w-full">
                        {busy === 'connecting' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          : <Link2 className="w-3.5 h-3.5 mr-1" />}
                        Connect Calendar
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Connected: actions and status */}
              {connected && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border p-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <span className="font-medium">Connected</span>
                    </div>
                    <p className={cn('text-xs', MUTED)}>
                      Last synced: {relativeSync(status?.lastSyncAt ?? null)}
                      {status && status.lastSyncImported > 0 && (
                        <> &middot; {status.lastSyncImported} entr{status.lastSyncImported === 1 ? 'y' : 'ies'} on the last sync</>
                      )}
                    </p>
                    <p className={cn('text-xs', MUTED)}>{PENDING_NOTE}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={handleSync} disabled={busy !== null}>
                      {busy === 'syncing' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                      Sync now
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDisconnectOpen(true)} disabled={busy !== null}>
                      <Unplug className="w-3.5 h-3.5 mr-1" /> Disconnect
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteOpen(true)}
                      disabled={busy !== null}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete saved connection
                    </Button>
                  </div>
                </div>
              )}

              {sparse && connected && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 px-3 py-2 text-sm">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{SPARSE_NOTE}</span>
                </div>
              )}

              {/* Imported entries and what each becomes */}
              {connected && events.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Imported entries</h3>
                  <p className={cn('text-xs', MUTED)}>
                    Each imported entry is created as a task by default. You can keep it as a
                    calendar-only event or ignore it instead.
                  </p>
                  <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                    {events.map((event) => (
                      <div key={event.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {event.summary || 'ManageBac calendar entry'}
                            </p>
                            <p className={cn('text-xs', MUTED, 'mt-0.5')}>
                              {event.due_at
                                ? `Due ${format(parseISO(event.due_at), 'd MMM yyyy')}`
                                : 'No date in the feed'}
                              {event.location ? ` \u00b7 ${event.location}` : ''}
                            </p>
                            <Badge variant="secondary" className="text-[10px] mt-1.5">
                              {MANAGEBAC_SOURCE_LABEL}
                            </Badge>
                          </div>
                          {eventBusy === event.external_uid && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {([
                            { id: 'task' as const, label: 'Import as Task', icon: ListTodo },
                            { id: 'event' as const, label: 'Keep as Calendar Event', icon: CalendarDays },
                            { id: 'ignored' as const, label: 'Ignore this event', icon: EyeOff },
                          ]).map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              disabled={eventBusy !== null}
                              onClick={() => handleDisposition(event, option.id)}
                              className={cn(
                                'flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors disabled:opacity-50',
                                event.disposition === option.id
                                  ? 'border-primary bg-primary/10 text-primary font-medium'
                                  : 'border-border text-muted-foreground hover:border-primary/40'
                              )}
                            >
                              <option.icon className="w-3 h-3" />
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {connected && events.length === 0 && (
                <p className={cn('text-xs', MUTED)}>
                  No entries imported yet. Press Sync now to load your ManageBac calendar.
                </p>
              )}

              {/* What changed: change inbox from recent syncs */}
              {connected && changes.length > 0 && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setChangesOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    aria-expanded={changesOpen}
                  >
                    <ChevronDown className={cn('w-4 h-4 transition-transform', changesOpen && 'rotate-180')} />
                    What changed ({unreadChanges > 0 ? `${unreadChanges} new` : 'all read'})
                  </button>
                  {changesOpen && (
                    <div className="space-y-2 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <p className={cn('text-xs', MUTED)}>
                          Detected automatically during syncs. Your own edits to imported tasks are never overwritten.
                        </p>
                        {unreadChanges > 0 && (
                          <Button variant="ghost" size="sm" onClick={handleMarkAllRead}>Mark all read</Button>
                        )}
                      </div>
                      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                        {changes.map((change) => (
                          <div
                            key={change.id}
                            className={cn(
                              'rounded-lg border p-3',
                              change.is_read ? 'border-border opacity-70' : 'border-primary/40 bg-primary/5'
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium">
                                  {change.change_kind === 'new' ? 'New' : 'Updated'}
                                  {' \u00b7 '}
                                  {changeSummary(change)}
                                </p>
                                <p className={cn('text-xs', MUTED, 'mt-0.5')}>
                                  Detected {format(parseISO(change.detected_at), 'd MMM yyyy, HH:mm')}
                                </p>
                              </div>
                              {!change.is_read && (
                                <Button variant="ghost" size="sm" onClick={() => handleMarkRead(change.id)}>
                                  Got it
                                </Button>
                              )}
                            </div>
                            {change.change_kind === 'edited' && (
                              <dl className="mt-2 space-y-1 text-xs">
                                {change.changes.map((entry, i) => (
                                  <div key={i} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
                                    <dt className="font-medium flex-shrink-0">{entry.label}:</dt>
                                    <dd className={cn('min-w-0', MUTED)}>
                                      <span className="line-through">{formatChangeValue(entry.previous)}</span>
                                      {' \u2192 '}
                                      <span className="text-foreground font-medium">{formatChangeValue(entry.next)}</span>
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-start gap-2 pt-1">
                <Info className={cn('w-3.5 h-3.5 flex-shrink-0 mt-0.5', MUTED)} />
                <p className={cn('text-xs', MUTED)}>
                  Imported entries appear on your Calendar and in your task list, support reminders,
                  and are marked with a {MANAGEBAC_SOURCE_LABEL} source badge so they are easy to tell
                  apart from tasks you created yourself.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect ManageBac Calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              Syncing will stop and your saved calendar link will be removed from our server.
              Tasks and events already imported into TaskTrack are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'disconnecting'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDisconnect(); }}
              disabled={busy === 'disconnecting'}
            >
              {busy === 'disconnecting' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved connection?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes your saved ManageBac link and the import history, and stops all future
              syncs. Tasks and events already imported into TaskTrack are kept, so you never lose
              any work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'deleting'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={busy === 'deleting'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy === 'deleting' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete connection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
