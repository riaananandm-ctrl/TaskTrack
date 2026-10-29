/**
 * Returns the URL only when it is a plain web address.
 *
 * Task links are free text, and some arrive from an imported school calendar, so
 * a stored `javascript:` or `data:` value must never become a clickable href in
 * the signed-in app. Anything that is not http/https is rejected.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
