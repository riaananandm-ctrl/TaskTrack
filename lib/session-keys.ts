const PRIORITY_ALERT_PREFIX = 'tasktrack-priority-alert-dismissed-';

export function priorityAlertKey(userId: string) {
  return `${PRIORITY_ALERT_PREFIX}${userId}`;
}

export function isPriorityAlertDismissed(userId: string) {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(priorityAlertKey(userId)) === 'true';
}

export function dismissPriorityAlert(userId: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(priorityAlertKey(userId), 'true');
}

export function clearPriorityAlert(userId: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(priorityAlertKey(userId));
}
