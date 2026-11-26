/** Helpers for showing a task's full description. */

export interface TextPart {
  text: string;
  /** Set when this part is a safe https link. */
  href?: string;
}

/** Split text into plain parts and https links. Only https links are made clickable. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /https:\/\/[^\s<>"')\]]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    // Leave trailing sentence punctuation out of the link.
    const url = match[0].replace(/[.,;:!?]+$/, '');
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** ManageBac's calendar feed cuts long descriptions short and ends them with "...". */
export function looksCutOff(text: string): boolean {
  return /(\.\.\.|…)\s*$/.test(text.trim());
}
