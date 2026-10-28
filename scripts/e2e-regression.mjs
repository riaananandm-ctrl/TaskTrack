import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { error } = await c.auth.signInWithPassword({
  email: 'e2e-pdf-test@tasktrack.test',
  password: 'E2eTest!2026pdf',
});
if (error) { console.log('signin failed:', error.message); process.exit(0); }
const file = new File([readFileSync('/tmp/sample.pdf')], 'sample.pdf', { type: 'application/pdf' });
const { data: r, error: rErr } = await c.rpc('reserve_document_upload', {
  p_file_name: 'sample.pdf', p_declared_mime: 'application/pdf',
  p_size_bytes: file.size, p_client_request_key: crypto.randomUUID(),
});
if (rErr) { console.log('reserve failed:', rErr.message); process.exit(0); }
const res = Array.isArray(r) ? r[0] : r;
const session = (await c.auth.getSession()).data.session;
const up = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/object/study-documents/' + res.storage_path, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/pdf' },
  body: file,
});
if (!up.ok) { console.log('upload failed', up.status); process.exit(0); }
const { data: proc, error: pErr } = await c.functions.invoke('documents-worker', {
  body: { documentId: res.document_id, reservationId: res.reservation_id },
});
console.log('worker:', JSON.stringify(proc ?? pErr));
if (proc?.ok) {
  const del = await c.rpc('delete_document', { p_document_id: res.document_id });
  console.log('cleanup:', del.error ? del.error.message : 'deleted');
}
