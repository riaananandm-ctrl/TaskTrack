// Full end-to-end test against the deployed system: real user session, real PDF
// upload through the student pipeline, study-session-chat with the attachment.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 1-2. Sign in with the dedicated e2e test user (already provisioned, confirmed).
const email = 'e2e-pdf-test@tasktrack.test';
const password = 'E2eTest!2026pdf';
const supabase = createClient(url, anon);
const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (signInError) { console.error('sign in failed:', signInError.message); process.exit(1); }
console.log('signed in, session ok');

// 3. Ensure a profile row exists (RLS: user-owned).
{
  const { data: prof } = await supabase.from('profiles').select('id').maybeSingle();
  if (!prof) {
    const { error } = await supabase.from('profiles').insert({});
    if (error) console.log('profile insert note:', error.message);
  }
}

// 4. Reserve → upload → process: the exact student flow.
const file = new File([readFileSync('/tmp/sample.pdf')], 'sample.pdf', { type: 'application/pdf' });
const { data: reserveData, error: reserveError } = await supabase.rpc('reserve_document_upload', {
  p_file_name: 'sample.pdf',
  p_declared_mime: 'application/pdf',
  p_size_bytes: file.size,
  p_client_request_key: crypto.randomUUID(),
});
if (reserveError) { console.error('reserve failed:', reserveError.message); process.exit(1); }
const reservation = Array.isArray(reserveData) ? reserveData[0] : reserveData;
console.log('reserved:', reservation.document_id, reservation.storage_path);

const session = (await supabase.auth.getSession()).data.session;
const uploadUrl = `${url}/storage/v1/object/study-documents/${reservation.storage_path}`;
const up = await fetch(uploadUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/pdf',
    'x-upsert': 'false',
  },
  body: file,
});
if (!up.ok) {
  console.error('storage upload failed:', up.status, (await up.text()).slice(0, 200));
  process.exit(1);
}
console.log('uploaded to storage');

// 5. Process through the deployed worker.
const { data: procData, error: procError } = await supabase.functions.invoke('documents-worker', {
  body: { documentId: reservation.document_id, reservationId: reservation.reservation_id },
});
if (procError) { console.error('worker error:', JSON.stringify(procError).slice(0, 300)); process.exit(1); }
console.log('worker result:', JSON.stringify(procData));

// 6. Verify ready status + usage charge + chunks with page refs.
const { data: docRow } = await supabase.from('documents')
  .select('id, status, error_code, extracted_chars, truncated')
  .eq('id', reservation.document_id).maybeSingle();
console.log('document row:', JSON.stringify(docRow));

const { count: usageCount } = await supabase.from('document_upload_usage')
  .select('id', { count: 'exact', head: true }).gte('usage_month', '2000-01-01');
console.log('usage rows charged:', usageCount);

const { data: chunks } = await supabase.from('document_chunks')
  .select('content, page').eq('document_id', reservation.document_id).order('chunk_index');
console.log('chunks:', JSON.stringify(chunks?.slice(0, 3)));

if (docRow?.status !== 'ready') { console.error('NOT READY — stopping before chat test'); process.exit(1); }

// 7. Ask the study-session assistant a question grounded in the document.
const { data: chatData, error: chatError } = await supabase.functions.invoke('study-session-chat', {
  body: {
    messages: [{ role: 'user', content: 'According to the attached document, what does it say exactly? Quote the text.' }],
    attachmentIds: [reservation.document_id],
    aiOption: 'tasktrack-ai',
    mode: 'chat',
  },
});
if (chatError) { console.error('chat error:', JSON.stringify(chatError).slice(0, 300)); process.exit(1); }
console.log('chat reply:', JSON.stringify(chatData).slice(0, 500));

// 8. Cleanup: delete the document.
const { error: delError } = await supabase.rpc('delete_document', {
  p_document_id: reservation.document_id,
});
console.log('cleanup:', delError ? delError.message : 'document deleted');
