import { supabase } from '@/lib/supabase/client';

/**
 * Client-side document library: reserve, upload, process, list, delete.
 * Every function is owner-scoped by the database; the client never passes a
 * user id and can never see another student's documents.
 */

export interface DocumentRow {
  id: string;
  file_name: string;
  size_bytes: number;
  status: 'awaiting_upload' | 'processing' | 'ready' | 'failed' | 'cancelled';
  error_code: string | null;
  extracted_chars: number;
  truncated: boolean;
  created_at: string;
}

export interface UploadReservation {
  documentId: string;
  reservationId: string;
  storagePath: string;
  expiresAt: string;
}

export interface UploadUsage {
  used: number;
  limit: number;
}

/**
 * The only content types TaskTrack stores, keyed by file extension. Uploads are
 * labelled from this map rather than from the browser's claimed type, so a file can
 * never be stored as something a browser would run (text/html, image/svg+xml, …).
 * Keep in step with the bucket's allowed_mime_types and reserve_document_upload.
 */
export const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function uploadContentType(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return UPLOAD_CONTENT_TYPES[ext] ?? null;
}

export class UploadError extends Error {
  code: string;
  constructor(message: string, code = 'UPLOAD_FAILED') {
    super(message);
    this.code = code;
  }
}

function safeError(error: { message?: string } | null, fallback: string): UploadError {
  // Never surface raw database or storage text to the student: it leaks table,
  // column, constraint and policy detail. Keep the detail in the console only.
  if (error?.message) console.error('Upload error', error.message);
  return new UploadError(fallback, 'UPLOAD_FAILED');
}

/** Ask the database for an upload slot. Throws UploadError with a safe message. */
export async function reserveUpload(
  file: File,
  clientRequestKey: string
): Promise<UploadReservation> {
  const contentType = uploadContentType(file.name);
  if (!contentType) throw new UploadError('That file type is not supported.', 'UNSUPPORTED_TYPE');
  const { data, error } = await supabase.rpc('reserve_document_upload', {
    p_file_name: file.name,
    p_declared_mime: contentType,
    p_size_bytes: file.size,
    p_client_request_key: clientRequestKey,
  });
  if (error) {
    const code = error.message;
    if (code.includes('quota_exceeded')) {
      throw new UploadError('You have used this month\u2019s document allowance. It resets on the 1st.', 'QUOTA_EXCEEDED');
    }
    if (code.includes('size_out_of_range')) {
      throw new UploadError('That file is over the 20 MB limit or empty.', 'SIZE_OUT_OF_RANGE');
    }
    if (code.includes('unsupported_type')) {
      throw new UploadError('That file type is not supported.', 'UNSUPPORTED_TYPE');
    }
    if (code.includes('not_authenticated')) {
      throw new UploadError('Please sign in again and retry.', 'NOT_AUTHENTICATED');
    }
    throw safeError(error, 'The upload could not be started. Please try again.');
  }
  const rows = data as Array<{
    document_id: string;
    reservation_id: string;
    storage_path: string;
    expires_at: string;
  }> | null;
  const row = rows?.[0];
  if (!row) throw new UploadError('The upload could not be started. Please try again.');
  return {
    documentId: row.document_id,
    reservationId: row.reservation_id,
    storagePath: row.storage_path,
    expiresAt: row.expires_at,
  };
}

/** Transfer the file to the private bucket. The caller's session token authorizes it. */
export async function transferFile(
  reservation: UploadReservation,
  file: File,
  onProgress?: (fraction: number) => void
): Promise<void> {
  // supabase-js storage upload does not report progress; for files this size we
  // stream via XHR so the student sees real movement.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new UploadError('Please sign in again and retry.', 'NOT_AUTHENTICATED');

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/study-documents/${reservation.storagePath}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('Content-Type', uploadContentType(file.name) ?? 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          console.error('Upload transfer failed', xhr.status, body.message || body.error);
        } catch {
          // response body was not JSON; nothing further to log
        }
        reject(new UploadError(`Upload failed (status ${xhr.status}).`, 'TRANSFER_FAILED'));
      }
    };
    xhr.onerror = () => reject(new UploadError('The connection dropped during the upload. Please try again.', 'NETWORK'));
    xhr.send(file);
  });
}

/** Hand the confirmed upload to the processing worker and wait for its verdict. */
export async function processDocument(
  documentId: string,
  reservationId: string
): Promise<{ ok: boolean; error?: string; errorCode?: string; documentId?: string }> {
  const { data, error } = await supabase.functions.invoke('documents-worker', {
    body: { documentId, reservationId },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = (await context.json()) as { error?: string; errorCode?: string };
        return { ok: false, error: body.error, errorCode: body.errorCode };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: 'Document processing is temporarily unavailable. Please try again.' };
  }
  const payload = data as { ok?: boolean; error?: string; errorCode?: string; documentId?: string } | null;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Document processing returned an unexpected response.' };
  }
  return {
    ok: Boolean(payload.ok),
    error: payload.error,
    errorCode: payload.errorCode,
    documentId: payload.documentId,
  };
}

/** Full pipeline for one file: reserve, transfer with progress, process. */
export async function uploadDocument(
  file: File,
  onProgress?: (phase: 'transferring' | 'processing', fraction: number) => void
): Promise<
  | { status: 'ready'; documentId: string; extractedChars: number }
  | { status: 'failed'; error: string }
> {
  const clientRequestKey = crypto.randomUUID();
  const reservation = await reserveUpload(file, clientRequestKey);
  try {
    onProgress?.('transferring', 0);
    await transferFile(reservation, file, (fraction) => onProgress?.('transferring', fraction));
    onProgress?.('processing', 1);
    const result = await processDocument(reservation.documentId, reservation.reservationId);
    if (!result.ok) {
      return { status: 'failed', error: result.error || 'This file could not be processed.' };
    }
    return { status: 'ready', documentId: result.documentId ?? reservation.documentId, extractedChars: 0 };
  } catch (err) {
    if (err instanceof UploadError) return { status: 'failed', error: err.message };
    return { status: 'failed', error: 'Something went wrong. Please try again.' };
  }
}

/** The student's own documents, newest first. */
export async function listDocuments(): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, file_name, size_bytes, status, error_code, extracted_chars, truncated, created_at')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('Your documents could not be loaded. Please try again.');
  return (data ?? []) as DocumentRow[];
}

/** This month's charged upload count against the plan limit. */
export async function getUploadUsage(): Promise<UploadUsage> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const month = monthStart.toISOString().slice(0, 10);

  const [{ count, error: usageError }, { data: planRow, error: planError }] = await Promise.all([
    supabase
      .from('document_upload_usage')
      .select('id', { count: 'exact', head: true })
      .gte('usage_month', month),
    supabase.from('documents').select('id', { count: 'exact', head: true }),
  ]);
  if (usageError || planError) {
    throw new Error('Upload usage could not be loaded.');
  }
  // The plan limit itself is enforced server-side; read it from plan_limits via
  // the documents count check being unreliable is not possible client-side, so
  // surface the effective limit from the profile plan.
  const { data: profile } = await supabase.from('profiles').select('plan').maybeSingle();
  const paid = ['pro', 'max'].includes(profile?.plan as string);
  const limit = paid ? 50 : 7;
  return { used: count ?? 0, limit };
}

/** Delete the student's own document. The monthly charge stays. */
export async function deleteDocument(documentId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_document', { p_document_id: documentId });
  if (error) throw new Error('The document could not be deleted. Please try again.');
}
