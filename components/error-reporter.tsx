'use client';

import { useEffect } from 'react';

let sent = 0;

/** Sends one browser error to /api/client-error. At most 5 per page load. */
export function reportClientError(kind: string, error: unknown) {
  if (typeof window === 'undefined' || sent >= 5) return;
  sent += 1;
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  const payload = JSON.stringify({ kind, message: e.message, stack: e.stack ?? '', path: window.location.pathname });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([payload], { type: 'application/json' }));
    else fetch('/api/client-error', { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' } });
  } catch {
    // ignore
  }
}

/** Listens for crashes anywhere in the app so we find out when something breaks. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      // Ignore noise from browser extensions and cross-origin scripts.
      if (!ev.error && (!ev.message || ev.message === 'Script error.')) return;
      reportClientError('error', ev.error ?? ev.message);
    };
    const onRejection = (ev: PromiseRejectionEvent) => reportClientError('unhandled_promise', ev.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
