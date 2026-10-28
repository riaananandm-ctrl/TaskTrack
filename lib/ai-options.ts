/**
 * AI product options (distinct from study modes).
 * "TaskTrack AI" is the default for everyone; "Study Bot" is a separate Premium option
 * backed by a specific model on the same configured provider (Groq), enforced
 * server-side in the study-session-chat function. The browser's plan is never trusted:
 * the server re-reads the plan from the database on every request.
 */

export type AiOptionId = 'tasktrack-ai' | 'study-bot';

export interface AiOption {
  id: AiOptionId;
  /** Product label shown to the student. */
  label: string;
  /** Short description of what this option is. */
  description: string;
  /** True when only Premium students can select this option. */
  premiumOnly: boolean;
  /**
   * The underlying provider model. This is a provider/model name, not a product name —
   * kept here so UI copy and server enforcement stay consistent.
   */
  modelId: string;
}

export const AI_OPTIONS: AiOption[] = [
  {
    id: 'tasktrack-ai',
    label: 'TaskTrack AI',
    description: 'Fast, reliable help for any subject. Included on every plan.',
    premiumOnly: false,
    modelId: 'auto',
  },
  {
    id: 'study-bot',
    label: 'Study Bot',
    description:
      'A separate Premium assistant option pinned to a specific model. Premium only.',
    premiumOnly: true,
    // A real Groq chat model, verified against the provider config in
    // study-session-chat: if the key cannot serve it the request fails with an
    // explicit "Study Bot is temporarily unavailable" error — it never silently
    // serves the default assistant under the Study Bot label.
    modelId: 'openai/gpt-oss-120b',
  },
];

export function getAiOption(id: string | null | undefined): AiOption {
  return AI_OPTIONS.find((o) => o.id === id) ?? AI_OPTIONS[0];
}

// ---------------------------------------------------------------------------
// Document upload constants shared by the upload dialog and attachment chips.
// These are the requested product limits; none of them are enforced by an existing
// backend yet, so the upload flow stays blocked until that backend is approved.
// ---------------------------------------------------------------------------

/** 20,000,000 bytes per document, in bytes. */
export const MAX_DOCUMENT_BYTES = 20_000_000;

export const UPLOAD_LIMITS = {
  free: 7,
  pro: 50,
} as const;

export const ACCEPTED_FILE_TYPES = [
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.webp', '.csv', '.xlsx',
];

export const ACCEPTED_MIME_HINT =
  'PDF, Word, PowerPoint, plain text, markdown, images (PNG/JPG/WebP), CSV and Excel files.';

/** Compact, student-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * The UTC calendar month a timestamp belongs to, e.g. "October 2026". Quotas reset on
 * the first of the month in UTC.
 */
export function utcMonthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Validate one file against the product limits. Shared by the file picker and the
 * drag-and-drop target so both entry points enforce identical rules. Returns a
 * rejection reason, or null when the file is acceptable.
 */
export function validateFile(file: { name: string; size: number }): string | null {
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `"${file.name}" is ${formatBytes(file.size)}, over the ${formatBytes(MAX_DOCUMENT_BYTES)} limit. Please split or compress it.`;
  }
  if (file.size === 0) {
    return `"${file.name}" is empty.`;
  }
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  if (!ACCEPTED_FILE_TYPES.includes(ext)) {
    return `"${file.name}" is not a supported file type.`;
  }
  return null;
}

/** The exact UTC instant the current monthly quota resets. */
export function nextUtcMonthStart(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  ).toISOString();
}
