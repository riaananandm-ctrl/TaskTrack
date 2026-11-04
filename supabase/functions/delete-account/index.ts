import { createClient } from 'npm:@supabase/supabase-js@2';

// Permanently deletes the *currently authenticated* account.
//
// Security model:
// - The caller's identity is taken ONLY from the JWT in the Authorization header.
// - Any user id sent in the request body is ignored entirely, so nobody can ask
//   this function to delete another account.
// - The service-role key is read from this function's own secrets and is never
//   logged, returned, or exposed to the browser.
//
// The user's own rows (tasks, reminders, study sessions, messages, scheduled
// sessions, AI usage, settings, ManageBac mapping, push subscriptions) all
// reference auth.users with ON DELETE CASCADE, so removing the auth user removes
// them in the same transaction. The profile row is deleted explicitly first for
// clarity and to cover any table without a cascade.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(
      { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } },
      405
    );
  }

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!serviceKey || !supabaseUrl || !anonKey) {
      console.error('Account deletion is not configured: missing server environment');
      return json(
        { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Account deletion is temporarily unavailable. Please try again later.' } },
        503
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(
        { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in again to delete your account.' } },
        401
      );
    }

    // Identify the caller from their own token. This client uses the anon key plus
    // the caller's Authorization header, so getUser() validates the real session.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return json(
        { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in again to delete your account.' } },
        401
      );
    }

    // The id comes from the verified session only. Body input is never read.
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Delete the Auth user FIRST. Every user-data table (profile, tasks, subjects,
    // reminders, sessions, documents, gamification, and the rest) references
    // auth.users with ON DELETE CASCADE (verified against the live database), so this
    // single call removes the account and all of its data in one step. Deleting the
    // profile first is avoided deliberately: if the Auth deletion then failed, the
    // student would be left with a half-deleted account that can no longer sign in
    // but still exists. If the cascading delete is somehow blocked by a stray table
    // without a cascade, the orphaned profile is cleaned up here as a fallback.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      // Distinguish a real failure from "already gone": an account deleted moments
      // earlier (double click, retry after a dropped connection) must report success.
      if (deleteError.status !== 404 && !/not found/i.test(deleteError.message)) {
        console.error('Account deletion: auth user removal failed');
        return json(
          { ok: false, error: { code: 'DELETE_FAILED', message: 'Your account could not be deleted. Please try again.' } },
          500
        );
      }
    }

    // Belt-and-braces: remove the profile row if any non-cascading link kept it alive.
    const { error: profileError } = await admin
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (profileError) {
      // The auth user is gone either way; only a stray row would remain. Report
      // success but log for diagnosis rather than telling the student it failed.
      console.error('Account deletion: post-cleanup profile row removal failed');
    }

    return json({ ok: true });
  } catch (err) {
    console.error('Account deletion failed:', err instanceof Error ? err.message : 'unknown error');
    return json(
      { ok: false, error: { code: 'UNKNOWN_SERVER_ERROR', message: 'Your account could not be deleted. Please try again.' } },
      500
    );
  }
});
