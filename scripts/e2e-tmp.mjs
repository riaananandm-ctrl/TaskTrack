// Full local end-to-end test: create a real test user session, reserve, upload,
// and call the deployed worker — reproducing the exact failing path.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, anon);

const email = `e2e-pdf-test-${Date.now()}@tasktrack.test`;
const password = 'Test1234!e2e';
const { data: signup, error: signupError } = await supabase.auth.signUp({ email, password });
if (signupError) { console.error('signup error:', signupError.message); process.exit(1); }
console.log('signed up user:', signup.user?.id);

// Email confirmation may block session; check.
const { data: session } = await supabase.auth.getSession();
console.log('has session:', Boolean(session?.session));
