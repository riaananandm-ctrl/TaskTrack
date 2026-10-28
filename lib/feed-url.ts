/**
 * ManageBac feed-URL normalization and masking.
 *
 * Pure functions, safe to use in the browser and in tests. The URL a student pastes is
 * normalized before it is ever sent anywhere: trimmed, webcal:// converted to https://
 * (case-insensitive), everything else preserved exactly — hostname, path, token, query
 * parameters and case are never altered or stripped.
 */

export type NormalizeResult =
  | { ok: true; url: string; converted: boolean }
  | { ok: false; reason: 'empty' | 'protocol' | 'invalid' };

export const FEED_COPY = {
  above: 'ManageBac gives you a calendar subscription link. We\u2019ll make it compatible with TaskTrack before connecting.',
  below: 'Keep this link private. It contains a token that grants access to your calendar.',
  converted: 'Link converted to HTTPS.',
  alreadyHttps: 'Your link is already in the correct format.',
  convertedButUnreachable: 'Link format corrected, but we couldn\u2019t access the calendar.',
} as const;

/**
 * Normalize a pasted calendar link. Returns the https:// URL unchanged in every
 * preserved part, or a reason the link cannot be used. No correction is guessed for
 * links that are neither webcal:// nor https://.
 */
export function normalizeFeedUrl(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  const webcalMatch = /^webcal:\/\//i.exec(trimmed);
  const candidate = webcalMatch ? `https://${trimmed.slice(webcalMatch[0].length)}` : trimmed;

  // An explicit scheme that is neither webcal nor https is rejected outright.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(candidate);
  if (schemeMatch && schemeMatch[1].toLowerCase() !== 'https') {
    return { ok: false, reason: 'protocol' };
  }
  if (!schemeMatch) {
    // No scheme at all: not a subscription link, and we do not guess one.
    return { ok: false, reason: 'invalid' };
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') return { ok: false, reason: 'protocol' };
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, url: candidate, converted: Boolean(webcalMatch) };
}

/**
 * A display-safe form of the link: scheme and host only. The path, token and query
 * parameters are never included in previews, errors, analytics or logs.
 */
export function maskFeedUrl(raw: string): string {
  try {
    return `${new URL(raw).origin}/\u2026`;
  } catch {
    return '(unparseable link)';
  }
}
