/**
 * The page to return to after signing in, from a `?next=` value. Only a path inside
 * TaskTrack is allowed. `//host` and `/\host` are rejected because browsers treat
 * both as another website, which would let a crafted link send a student elsewhere.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/')) return null;
  if (next.startsWith('//') || next.includes('\\')) return null;
  // Control characters (tab, newline) are stripped by browsers and can hide a second slash.
  if (/[\u0000-\u001f]/.test(next)) return null;
  return next;
}
