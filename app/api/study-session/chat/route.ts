// The AI call runs in the Supabase edge function `study-session-chat`, which is the
// only place that can read the GROQ_API_KEY secret at runtime. This route is the
// app's own server-side entry point and never touches the key or the plan limits —
// it forwards the signed-in user's token so the function can identify them.
//
// It deliberately uses the Web-standard Request/Response API rather than
// `NextRequest`/`NextResponse`. Those helpers depend on Next's per-request async
// storage, which is not available on every host and throws
// "headers() expects to have requestAsyncStorage" when it is missing — a failure
// that surfaced to students as a generic error on every request.
//
// Every code path returns JSON. Each stage reports its own safe error code so a
// failure names the exact step, and reading the request headers/body is written to
// tolerate host differences rather than throw.

// Always handled at request time. Without this, Next may evaluate the module during
// build/static analysis where no request context exists.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ChatErrorBody {
  error?: { code?: string; message?: string } | string;
}

/** The step a failure happened at. Used only for safe server-side diagnostics. */
type Stage =
  | 'parse_body'
  | 'auth'
  | 'config'
  | 'invoke'
  | 'parse_upstream'
  | 'respond';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

/**
 * Safe server-side diagnostics for one stage. Records only the stage, status, error
 * code, mode and session id, and whether the secret is present — never its value,
 * and never tokens, headers, cookies or message content.
 */
function logStage(
  stage: Stage,
  info: {
    status?: number;
    code?: string;
    mode?: string | null;
    sessionId?: string | null;
    keyPresent?: boolean;
  } = {}
) {
  try {
    console.error('[study-assistant]', {
      stage,
      status: info.status,
      code: info.code,
      mode: info.mode ?? undefined,
      sessionId: info.sessionId ?? undefined,
      keyPresent: info.keyPresent,
    });
  } catch {
    // Logging must never be able to fail the request.
  }
}

/** The Edge Function URL, resolved from whatever Supabase URL this environment has. */
function functionUrl(): string {
  const configured = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return `${configured.replace(/\/+$/, '')}/functions/v1/study-session-chat`;
}

/**
 * The gateway apikey only has to be a valid key for this project; the function
 * identifies the student from the Authorization header, so the student's own token
 * remains the thing that is trusted.
 */
function gatewayKey(): string {
  // Never the service-role key: it would grant far more than this request needs.
  return process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

/**
 * Read a request header whether the host supplies a standards `Headers` object or a
 * plain object. This is what makes the route behave the same on every host rather
 * than throwing when a helper it assumes is missing.
 */
function readHeader(req: Request, name: string): string | null {
  const headers = (req as unknown as { headers?: unknown }).headers;
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const plain = headers as Record<string, unknown>;
  const value = plain[name] ?? plain[name.toLowerCase()];
  return typeof value === 'string' ? value : null;
}

/** Read the JSON body defensively, whichever body reader the host provides. */
async function readJsonBody(req: Request): Promise<unknown> {
  const r = req as unknown as { json?: () => Promise<unknown>; text?: () => Promise<string> };
  if (typeof r.json === 'function') return await r.json();
  if (typeof r.text === 'function') {
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }
  const body = (req as unknown as { body?: unknown }).body;
  if (typeof body === 'string') return body ? JSON.parse(body) : null;
  return null;
}

/** Read an upstream error message whether it arrives as an object or a string. */
function upstreamError(body: ChatErrorBody): { code: string; message: string } {
  const raw = body.error;
  if (raw && typeof raw === 'object') {
    return {
      code: typeof raw.code === 'string' && raw.code ? raw.code : 'PROVIDER_ERROR',
      message:
        typeof raw.message === 'string' && raw.message
          ? raw.message
          : 'TaskTrack AI is temporarily unavailable. Please try again later.',
    };
  }
  if (typeof raw === 'string' && raw) {
    return { code: 'PROVIDER_ERROR', message: raw };
  }
  return {
    code: 'PROVIDER_ERROR',
    message: 'TaskTrack AI is temporarily unavailable. Please try again later.',
  };
}

/**
 * A safe health check. Opening /api/study-session/chat in a browser returns JSON when
 * the route is being executed. It reports only whether the assistant is reachable.
 */
export async function GET(): Promise<Response> {
  const configured = /^https?:\/\//.test(functionUrl());
  return jsonResponse({ ok: configured, route: 'study-session-chat', functionConfigured: configured });
}

/**
 * A last line of defence: whatever happens inside, the browser gets JSON and never the
 * host's HTML error page. The real cause is logged server-side only.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logStage('respond', { status: 500, code: 'UNKNOWN_SERVER_ERROR' });
    console.error(
      'Study session route threw before responding:',
      err instanceof Error ? err.message : 'unknown error'
    );
    return errorResponse(
      'UNKNOWN_SERVER_ERROR',
      'TaskTrack AI could not complete that request. Please try again.',
      500
    );
  }
}

async function handlePost(req: Request): Promise<Response> {
  let mode: string | null = null;
  let sessionId: string | null = null;
  let stage: Stage = 'parse_body';

  // 1. Body parsing. Each stage is wrapped so a failure names itself.
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    logStage('parse_body', { status: 400, code: 'INVALID_REQUEST' });
    return errorResponse('INVALID_REQUEST', 'Invalid request body.', 400);
  }

  if (body && typeof body === 'object') {
    const b = body as { mode?: unknown; sessionId?: unknown };
    mode = typeof b.mode === 'string' ? b.mode : null;
    sessionId = typeof b.sessionId === 'string' ? b.sessionId : null;
  }

  // 2. Authentication.
  stage = 'auth';
  const authHeader = readHeader(req, 'authorization');
  if (!authHeader) {
    logStage('auth', { status: 401, code: 'UNAUTHENTICATED', mode, sessionId });
    return errorResponse('UNAUTHENTICATED', 'Please sign in to use TaskTrack AI.', 401);
  }

  // 3. Configuration. Resolving the environment is guarded too, so a host that lacks
  //    the expected variables reports a clear code rather than throwing.
  stage = 'config';
  let url: string;
  try {
    url = functionUrl();
  } catch {
    url = '';
  }
  if (!/^https?:\/\//.test(url)) {
    logStage('config', { status: 503, code: 'MISSING_KEY', mode, sessionId });
    return errorResponse('MISSING_KEY', 'TaskTrack AI is not configured yet.', 503);
  }

  // 4. Invoke the edge function. A network fault is its own safe code.
  stage = 'invoke';
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        Apikey: gatewayKey(),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logStage('invoke', { status: 502, code: 'FUNCTION_INVOKE_FAILED', mode, sessionId });
    console.error(
      'Study session proxy could not reach the function:',
      err instanceof Error ? err.message : 'unknown error'
    );
    return errorResponse(
      'FUNCTION_INVOKE_FAILED',
      'Could not reach TaskTrack AI. Please check your connection and try again.',
      502
    );
  }

  // 5. Read and parse the function's reply.
  stage = 'parse_upstream';
  let text: string;
  try {
    text = await response.text();
  } catch {
    logStage('parse_upstream', { status: 502, code: 'PROVIDER_EMPTY_RESPONSE', mode, sessionId });
    return errorResponse(
      'PROVIDER_EMPTY_RESPONSE',
      'TaskTrack AI did not return a response. Please try again.',
      502
    );
  }

  let data: {
    ok?: boolean;
    mode?: string;
    text?: string;
    structured?: unknown;
    messageId?: string | null;
    usage?: { used: number; dailyLimit: number } | null;
    error?: { code?: string; message?: string } | string;
  };
  try {
    data = text ? (JSON.parse(text) as typeof data) : {};
  } catch {
    // A non-JSON upstream body is reported by status only; no payload is stored.
    logStage('parse_upstream', { status: response.status, code: 'PROVIDER_REQUEST_FAILED', mode, sessionId });
    return errorResponse(
      'PROVIDER_REQUEST_FAILED',
      'TaskTrack AI returned an unexpected response. Please try again.',
      502
    );
  }

  if (!response.ok || data.ok === false) {
    const { code, message } = upstreamError(data);
    logStage('parse_upstream', {
      status: response.status,
      code,
      mode,
      sessionId,
      keyPresent: code !== 'MISSING_KEY',
    });
    return errorResponse(code, message, response.status === 200 ? 502 : response.status);
  }

  const hasText = typeof data.text === 'string' && data.text.trim().length > 0;
  const hasStructured = data.structured != null;
  if (!hasText && !hasStructured) {
    logStage('parse_upstream', { status: 502, code: 'PROVIDER_EMPTY_RESPONSE', mode, sessionId });
    return errorResponse(
      'PROVIDER_EMPTY_RESPONSE',
      'TaskTrack AI did not return a response. Please try again.',
      502
    );
  }

  // 6. Respond in the contract the app expects.
  stage = 'respond';
  try {
    return jsonResponse(
      {
        ok: true,
        mode: data.mode ?? null,
        text: hasText ? data.text : '',
        structured: hasStructured ? data.structured : null,
        messageId: data.messageId ?? null,
        usage: data.usage ?? null,
      },
      200
    );
  } catch (err) {
    logStage('respond', { status: 500, code: 'UNKNOWN_SERVER_ERROR', mode, sessionId });
    console.error('Study session response build failed:', err instanceof Error ? err.message : 'unknown');
    return errorResponse(
      'UNKNOWN_SERVER_ERROR',
      'TaskTrack AI could not complete that request. Please try again.',
      500
    );
  }
}
