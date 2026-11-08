'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/lib/types';
import { clearPriorityAlert } from '@/lib/session-keys';
import { markRecoveryHandoff, clearRecoveryHint, claimRecoveryRedirect } from '@/lib/password-recovery';
import { isAssessPrepTask, getTaskDeadline } from '@/lib/deadline-status';
import { cleanupPastAssessPrepTasks } from '@/lib/assessprep-cleanup';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** True when the user exists but their email is not confirmed yet. */
  emailConfirmed: boolean;
  signOut: () => Promise<void>;
  /** Clear the remembered-device choice and the local session, then sign out. */
  forgetDevice: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  emailConfirmed: false,
  signOut: async () => {},
  forgetDevice: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const assessprepCleanedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    // Register the auth listener BEFORE calling getSession so we never miss
    // an event that fires between the two calls.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // PASSWORD_RECOVERY: remember (hint only, not proof) that a recovery exchange
        // just succeeded, then land on the reset screen. On this route the provider
        // state is preserved with a client-side push; from any other route we do a full
        // navigation, and the fresh hint is what lets the reset screen stay in its
        // recovery framing after the reload.
        if (event === 'PASSWORD_RECOVERY' && typeof window !== 'undefined') {
          // Single-owner claim: if the RecoveryLinkGuard got here first, it owns the
          // navigation and we only persist the handoff hint it will read on the reset
          // screen. Whoever claims it owns the redirect; the other never navigates.
          markRecoveryHandoff();
          if (claimRecoveryRedirect() && !window.location.pathname.startsWith('/reset-password')) {
            window.location.replace('/reset-password');
            return;
          }
          setSession(session);
          setUser(session?.user ?? null);
          setEmailConfirmed(true);
          setLoading(false);
          return;
        }

        // TOKEN_REFRESHED: replace the session without logging out.
        if (event === 'TOKEN_REFRESHED') {
          if (session) {
            setSession(session);
            setUser(session.user ?? null);
          }
          return;
        }

        // USER_UPDATED: refresh user data without logging out.
        if (event === 'USER_UPDATED') {
          if (session) {
            setSession(session);
            setUser(session.user ?? null);
          }
          return;
        }

        // SIGNED_OUT: clear everything and finish loading.
        if (event === 'SIGNED_OUT') {
          // The recovery handoff hint is flow UI state, not session data; drop it
          // whenever the session ends so it can never outlive its flow.
          clearRecoveryHint();
          setSession(null);
          setUser(null);
          setProfile(null);
          setEmailConfirmed(false);
          setLoading(false);
          return;
        }

        // INITIAL_SESSION and SIGNED_IN: set the session.
        setSession(session);
        setUser(session?.user ?? null);

        const confirmed = !!session?.user?.email_confirmed_at || !!session?.user?.confirmed_at;
        setEmailConfirmed(confirmed);

        if (session?.user && !confirmed) {
          // Unconfirmed user — sign out so the protected route redirects to login.
          (async () => {
            await supabase.auth.signOut({ scope: 'local' });
          })();
          setSession(null);
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        if (session?.user) {
          (async () => {
            await loadProfile(session.user.id);
          })();
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    // Call getSession() after the listener is registered. If there is no
    // session, the listener's INITIAL_SESSION event will handle it.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;

      // If the access token is expired, try one refresh before giving up.
      if (session?.expires_at && session.expires_at * 1000 < Date.now()) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshData.session) {
          // The refresh token is also invalid. Sign out locally only.
          await supabase.auth.signOut({ scope: 'local' });
          if (!mounted) return;
          setSession(null);
          setUser(null);
          setProfile(null);
          setEmailConfirmed(false);
          setLoading(false);
          return;
        }
        session = refreshData.session;
      }

      const confirmed = !!session?.user?.email_confirmed_at || !!session?.user?.confirmed_at;
      setSession(session);
      setUser(session?.user ?? null);
      setEmailConfirmed(confirmed);

      if (session?.user && confirmed) {
        loadProfile(session.user.id);
      } else if (session?.user && !confirmed) {
        await supabase.auth.signOut({ scope: 'local' });
        if (!mounted) return;
        setSession(null);
        setUser(null);
        setProfile(null);
        setLoading(false);
      } else {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    setProfile(data as Profile | null);
    setLoading(false);

    // Run AssessPrep cleanup once per session after the profile loads.
    if (userId && !assessprepCleanedRef.current) {
      assessprepCleanedRef.current = true;
      cleanupPastAssessPrepTasks(userId).catch(() => {
        // Cleanup failure must never affect the session.
      });
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await loadProfile(user.id);
    }
  };

  const signOut = async () => {
    if (user) clearPriorityAlert(user.id);
    await supabase.auth.signOut({ scope: 'local' });
    clearRecoveryHint();
    setProfile(null);
    setUser(null);
    setSession(null);
  };

  const forgetDevice = async () => {
    await signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, emailConfirmed, signOut, forgetDevice, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
