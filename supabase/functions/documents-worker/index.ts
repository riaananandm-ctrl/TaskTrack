import { createClient } from 'npm:@supabase/supabase-js@2';
import { extractPdfPages, pdfPagesToChunks } from './pdf-extract.ts';

/**
 * Document processing worker.
 *
 * Runs after a student's file transfer to the private `study-documents` bucket
 * completes. Flow per document:
 *   1. confirm_document_upload — starts a processing lease (quota slot held).
 *   2. Extract text: plain text, markdown, CSV, and PDF (text layer, with real
 *      page references). Unsupported or unreadable inputs fail with a specific
 *      error code and message — never a generic retry.
 *   3. finalize_document_ready with the extracted chunks (charging quota once)
 *      or finalize_document_failed (releasing the slot, no charge).
 *
 * Every path after confirm is wrapped so an unexpected throw still finalizes
 * the document as failed. A crash here previously left documents stuck in
 * `processing` with no error code until the sweeper timed them out.
 *
 * Auth: every non-sweep call must carry a valid user JWT; the worker only ever
 * processes that user's own documents. The scheduled sweep runs with a shared
 * cron secret and releases expired reservations / times out stale processing.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface DocumentRow {
  id: string;
  owner_id: string;
  file_name: string;
  size_bytes: number;
  storage_path: string;
  status: string;
  attempt_token: string | null;
}

const MAX_EXTRACTED_CHARS = 400_000;
const CHUNK_SIZE = 4000;
/** Hard deadline for download+extract; a hung stream resolves to a specific
 * failure instead of leaving the document stuck until the sweep. */
const EXTRACT_DEADLINE_MS = 25_000;

/** Reject a promise that settles too late, without cancelling the work. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('extract_deadline')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/** Thrown by extraction; maps to a specific, student-readable failure. */
class ExtractionError extends Error {
  code: string;
  message: string;
  constructor(code: string, message: string) {
    super(code);
    this.code = code;
    this.message = message;
  }
}

const startsWith = (bytes: Uint8Array, sig: number[], at = 0) =>
  bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);

/**
 * True when the file's first bytes match what its extension promises. Stops a
 * renamed file (an .html, .exe or .svg called "notes.png") from being treated as
 * the safe type it claims to be.
 */
function contentMatchesExtension(bytes: Uint8Array, ext: string): boolean {
  const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx, pptx, xlsx are zip packages
  const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy doc, ppt
  switch (ext) {
    case 'pdf': {
      // %PDF- may follow a little junk at the start; scan the first KB.
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
      return head.includes('%PDF-');
    }
    case 'png': return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg': case 'jpeg': return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'webp': return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case 'docx': case 'pptx': case 'xlsx': return startsWith(bytes, ZIP);
    case 'doc': case 'ppt': return startsWith(bytes, OLE);
    case 'txt': case 'md': case 'csv': {
      // Plain text has no NUL bytes; binaries almost always do.
      const sample = bytes.subarray(0, 8192);
      return !sample.includes(0);
    }
    default: return false;
  }
}

async function extractText(
  bytes: Uint8Array,
  fileName: string
): Promise<{ chunks: Array<{ c: string; p?: number }>; truncated: boolean }> {
  const ext = extensionOf(fileName);

  if (!contentMatchesExtension(bytes, ext)) {
    throw new ExtractionError('FILE_TYPE_MISMATCH', 'This file is not really the type its name says, so it was not opened. Upload the original file.');
  }

  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.trim().length === 0) throw new ExtractionError('EMPTY_EXTRACTION', 'No readable text was found in this file.');
    const truncated = text.length > MAX_EXTRACTED_CHARS;
    const body = truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text;
    const chunks: Array<{ c: string; p?: number }> = [];
    for (let i = 0; i < body.length; i += CHUNK_SIZE) {
      const piece = body.slice(i, i + CHUNK_SIZE).trim();
      if (piece) chunks.push({ c: piece, p: 0 });
    }
    if (chunks.length === 0) throw new ExtractionError('EMPTY_EXTRACTION', 'No readable text was found in this file.');
    return { chunks, truncated };
  }

  if (ext === 'pdf') {
    const result = await extractPdfPages(bytes);
    if (!result.ok) {
      switch (result.code) {
        case 'ENCRYPTED_PDF':
          throw new ExtractionError('ENCRYPTED_PDF', 'This PDF is password-protected. Remove the password and upload it again.');
        case 'SCANNED_PDF_NO_TEXT':
          throw new ExtractionError('SCANNED_PDF_NO_TEXT', 'This PDF has no selectable text — it looks like a scan or image-only export, which cannot be read yet.');
        case 'PDF_TOO_LARGE':
          throw new ExtractionError('PDF_TOO_LARGE', 'This PDF is too large to process (over 20 MB of file data). Split it into smaller parts.');
        case 'UNREADABLE_TEXT':
          throw new ExtractionError('UNREADABLE_TEXT', 'This PDF uses a font encoding that could not be decoded, so its text is not readable. Try re-exporting it from the original app, or upload a copy with selectable, standard text.');
        default:
          throw new ExtractionError('CORRUPT_PDF', 'This file is not a readable PDF — it may be damaged or mislabelled.');
      }
    }
    const chunks = pdfPagesToChunks(result.pages);
    if (chunks.length === 0) throw new ExtractionError('EMPTY_EXTRACTION', 'No readable text was found in this PDF.');
    return { chunks, truncated: false };
  }

  // doc(x), ppt(x), xlsx, images: no parser in this stage.
  throw new ExtractionError(
    'UNSUPPORTED_FORMAT',
    'Text extraction for this file type is not available yet, so it was not processed and did not count against your monthly allowance.'
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }

  let admin: ReturnType<typeof createClient> | null = null;
  // Set after a successful confirm; drives the always-finalize guard below.
  let confirmed: { documentId: string; attemptToken: string } | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ ok: false, error: 'Document processing is not configured.' }, 503);
    }

    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({} as { action?: string }));
    const isSweep = body?.action === 'sweep';

    // ---- Scheduled sweep: shared secret only ----
    if (isSweep) {
      const { data: secretRow } = await admin
        .from('document_upload_config')
        .select('sweep_cron_secret')
        .eq('id', 1)
        .maybeSingle();
      const secret = req.headers.get('x-sweep-secret');
      if (!secretRow || !secret || secret !== (secretRow as { sweep_cron_secret: string }).sweep_cron_secret) {
        return json({ ok: false, error: 'Not authorised.' }, 401);
      }
      const { data: sweepResult, error: sweepError } = await admin.rpc('sweep_document_uploads');
      if (sweepError) return json({ ok: false, error: 'Sweep failed.' }, 500);
      return json({ ok: true, sweep: sweepResult });
    }

    // ---- Authenticated run: process this user's document ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ ok: false, error: 'Please sign in again and retry.' }, 401);
    }
    const userId = userData.user.id;

    const payload = body as { documentId?: string; reservationId?: string };
    if (!payload.documentId || !payload.reservationId) {
      return json({ ok: false, error: 'Missing document reference.' }, 400);
    }

    // The document must belong to the caller and be awaiting processing.
    const { data: docRow, error: docError } = await admin
      .from('documents')
      .select('id, owner_id, file_name, size_bytes, storage_path, status, attempt_token')
      .eq('id', payload.documentId)
      .eq('owner_id', userId)
      .maybeSingle();
    if (docError || !docRow) {
      return json({ ok: false, error: 'Document not found.' }, 404);
    }
    const doc = docRow as DocumentRow;
    if (doc.status !== 'awaiting_upload') {
      return json({ ok: false, error: 'This document is not awaiting an upload.' }, 409);
    }

    // 1. Confirm: starts the processing lease.
    const { data: token, error: confirmError } = await admin.rpc('confirm_document_upload', {
      p_document_id: doc.id,
      p_reservation_id: payload.reservationId,
      p_actual_bytes: doc.size_bytes,
    });
    if (confirmError) {
      return json({ ok: false, error: 'The upload could not be confirmed. Please try again.' }, 409);
    }
    const attemptToken = token as string;
    confirmed = { documentId: doc.id, attemptToken };

    // Failure helper: always finalizes (releases the slot, no charge) and
    // returns the specific message to the student.
    const fail = async (code: string, message: string, status = 422) => {
      await admin.rpc('finalize_document_failed', {
        p_document_id: confirmed!.documentId,
        p_attempt_token: confirmed!.attemptToken,
        p_error: code,
      }).catch(() => undefined);
      confirmed = null;
      return json({ ok: false, error: message, errorCode: code }, status);
    };

    // 2. Read back and extract under one hard deadline. A hang (e.g. a
    // DecompressionStream that never settles) resolves to a specific,
    // zero-charge failure instead of a 10-minute stuck document.
    let bytes: Uint8Array;
    let chunks: Array<{ c: string; p?: number }>;
    let truncated = false;
    try {
      await withDeadline((async () => {
        const { data: objectData, error: downloadError } = await admin.storage
          .from('study-documents')
          .download(doc.storage_path);
        if (downloadError || !objectData) {
          throw new ExtractionError('STORAGE_READ_FAILED', 'The uploaded file could not be read back for processing.');
        }
        bytes = new Uint8Array(await objectData.arrayBuffer());
        if (bytes.length !== doc.size_bytes) {
          throw new ExtractionError('SIZE_MISMATCH', 'The stored file size does not match what was uploaded.');
        }
        const extraction = await extractText(bytes, doc.file_name);
        chunks = extraction.chunks;
        truncated = extraction.truncated;
      })(), EXTRACT_DEADLINE_MS);
    } catch (err) {
      if (err instanceof ExtractionError) {
        return fail(err.code, err.message);
      }
      const timedOut = err instanceof Error && err.message === 'extract_deadline';
      console.error('Extract stage failed:', err instanceof Error ? err.message : 'unknown');
      return fail(
        timedOut ? 'PROCESSING_TIMEOUT' : 'EXTRACTION_CRASHED',
        timedOut
          ? 'This file took too long to read and was not processed — it did not count against your monthly allowance. Try re-exporting the PDF.'
          : 'This file could not be read. Please try again or use a different format.'
      );
    }

    // 3. Finalize ready: charges the quota exactly once.
    const { error: readyError } = await admin.rpc('finalize_document_ready', {
      p_document_id: doc.id,
      p_attempt_token: attemptToken,
      p_chunks: chunks,
      p_truncated: truncated,
    });
    if (readyError) {
      console.error('finalize_document_ready failed:', readyError.message);
      // Finalize the failure too: otherwise the reservation stays confirmed and
      // the document sticks in processing until the sweep (seen with chunks
      // Postgres jsonb rejects, e.g. strings containing U+0000).
      await admin.rpc('finalize_document_failed', {
        p_document_id: doc.id,
        p_attempt_token: attemptToken,
        p_error: 'FINALIZE_FAILED',
      }).catch(() => undefined);
      confirmed = null;
      return json({ ok: false, error: 'Processing could not be completed. Please try again.', errorCode: 'FINALIZE_FAILED' }, 500);
    }
    confirmed = null;

    return json({
      ok: true,
      documentId: doc.id,
      status: 'ready',
      extractedChars: chunks.reduce((sum, c) => sum + c.c.length, 0),
      truncated,
    });
  } catch (err) {
    console.error('Document worker failed:', err instanceof Error ? err.message : 'unknown');
    // Unexpected crash after confirm: still finalize so the slot is released
    // and the student sees a specific failure instead of a stuck document.
    if (admin && confirmed) {
      await admin.rpc('finalize_document_failed', {
        p_document_id: confirmed.documentId,
        p_attempt_token: confirmed.attemptToken,
        p_error: 'WORKER_CRASH',
      }).catch(() => undefined);
    }
    return json(
      { ok: false, error: 'This file could not be processed.', errorCode: 'WORKER_CRASH' },
      500
    );
  }
});
