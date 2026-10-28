// Server-side proxy that permanently deletes the signed-in student's account.
//
// The browser never holds or sees the service-role key. The Supabase Edge
// Function `delete-account` performs the privileged work; this route forwards the
// caller's own Authorization header so the function can identify them from their
// JWT. No user id is ever read from the request body.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function functionUrl(): string {
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return `${base.replace(/\/+$/, '')}/functions/v1/delete-account`;
}

function gatewayKey(): string {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  );
}

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

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 200, headers: CORS });
}

export async function POST(req: Request): Promise<Response> {
  const authHeader = readHeader(req, 'authorization');
  if (!authHeader) {
    return json(
      { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in again to delete your account.' } },
      401
    );
  }

  const url = functionUrl();
  if (!/^https?:\/\//.test(url)) {
    return json(
      { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Account deletion is temporarily unavailable. Please try again later.' } },
      503
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        Apikey: gatewayKey(),
      },
      // Deliberately empty: the function derives the user from the token above.
      body: JSON.stringify({}),
    });
  } catch {
    return json(
      { ok: false, error: { code: 'FUNCTION_INVOKE_FAILED', message: 'Your account could not be deleted. Please check your connection and try again.' } },
      502
    );
  }

  const text = await response.text();
  return new Response(text || JSON.stringify({ ok: false }), {
    status: response.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
