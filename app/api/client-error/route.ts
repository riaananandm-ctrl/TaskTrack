import { NextResponse } from 'next/server';

/**
 * Receives crash reports from students' browsers and writes them to the server log,
 * where they show up in Vercel's Logs tab. Only the error text, the page path and the
 * browser are kept, trimmed; nothing about the student is sent or stored.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
    const report = {
      kind: clip(body.kind, 30),
      message: clip(body.message, 300),
      stack: clip(body.stack, 1200),
      path: clip(body.path, 200).split('?')[0],
      browser: clip(req.headers.get('user-agent'), 160),
    };
    if (report.message) console.error('[client-error]', JSON.stringify(report));
  } catch {
    // Never fail the student's page because of a report.
  }
  return new NextResponse(null, { status: 204 });
}
