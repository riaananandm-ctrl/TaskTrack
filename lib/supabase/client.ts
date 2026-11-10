import { createClient } from '@supabase/supabase-js';
import { authStorage } from '@/lib/auth-storage';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Honors "Stay logged in for 30 days": checked -> localStorage (survives browser
    // restarts); unchecked -> sessionStorage (cleared when the tab closes).
    storage: authStorage,
  },
});
