/** A real IANA zone ("Asia/Kolkata", "UTC"). Free text like "IST" is rejected. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz === 'UTC' || tz.includes('/');
  } catch {
    return false;
  }
}

/** The zone this phone or computer is set to, or '' if the browser won't say. */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return isValidTimeZone(tz) ? tz : '';
  } catch {
    return '';
  }
}

const FALLBACK_ZONES = [
  'UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
  'America/Los_Angeles', 'Australia/Sydney', 'Africa/Johannesburg',
];

/** Every zone the browser knows, with the current and device zones always included. */
export function timeZoneOptions(current?: string): string[] {
  let zones: string[] = FALLBACK_ZONES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (supported && supported.length) zones = ['UTC', ...supported];
  } catch {
    // older browser: the short list above
  }
  const extra = [current, deviceTimeZone()].filter((z): z is string => !!z && isValidTimeZone(z));
  return Array.from(new Set([...extra, ...zones]));
}
