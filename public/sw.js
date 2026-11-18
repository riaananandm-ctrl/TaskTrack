// TaskTrack service worker.
//
// Its only job is to receive a push message from the browser push service while
// TaskTrack is backgrounded or closed, show a notification, and open the right
// screen when the notification is tapped. It holds no secrets and reads nothing
// from storage — the payload it displays is the one the server sent.

const DEFAULT_TITLE = 'TaskTrack study reminder';
const DEFAULT_BODY = 'You have an upcoming study session.';

// The push payload is JSON produced by the sender function. If anything about it
// is unexpected, fall back to a safe generic notification rather than failing.
function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    return {};
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title
    : DEFAULT_TITLE;
  const body = typeof payload.body === 'string' && payload.body.trim()
    ? payload.body
    : DEFAULT_BODY;

  const target =
    typeof payload.taskId === 'string'
      ? `/app/tasks?task=${encodeURIComponent(payload.taskId)}`
      : typeof payload.sessionId === 'string'
        ? `/app/study-sessions?session=${encodeURIComponent(payload.sessionId)}`
        : '/app/notifications';

  // `tag` collapses repeat notifications for the same reminder into one, so a
  // student never sees the same reminder stacked up. `renotify` makes a replacement
  // still pop up and make a sound: without it, a new notification that reuses an
  // older one's tag (e.g. a second "Test notification") is swapped in silently.
  const tag = typeof payload.tag === 'string' ? payload.tag : undefined;
  const options = {
    body,
    icon: '/assets/images/Screenshot_2026-09-28_at_9.58.09_AM-removebg-preview.png',
    badge: '/assets/images/Screenshot_2026-09-28_at_9.58.09_AM-removebg-preview.png',
    data: { url: target },
    tag,
    renotify: Boolean(tag),
    // Ask for a non-silent notification. The final sound is controlled by the
    // browser and the operating system, which TaskTrack cannot override.
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || '/app/notifications';

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an already-open TaskTrack tab and steer it to the reminder, so the
      // student lands on the correct task or study session rather than a duplicate tab.
      for (const client of allClients) {
        if ('focus' in client) {
          try {
            await client.focus();
            if ('navigate' in client) await client.navigate(target);
            return;
          } catch {
            // Fall through to opening a new window.
          }
        }
      }
      await clients.openWindow(target);
    })()
  );
});
