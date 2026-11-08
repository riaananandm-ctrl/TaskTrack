'use client';

import { useEffect } from 'react';
import { readRecoveryParams, claimRecoveryRedirect } from '@/lib/password-recovery';

/**
 * Catches a password-reset link wherever it lands.
 *
 * Supabase only redirects to URLs on the project's allow list; anything else falls back
 * to the Site URL, which can be the marketing page rather than /reset-password. Rather
 * than depend on that setting, any page carrying `type=recovery` forwards itself to the
 * reset screen, fragment included, so the session is still there when it arrives.
 *
 * Only a link that declares itself a recovery link is forwarded — a sign-up confirmation
 * that landed here is left alone.
 */
export function RecoveryLinkGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname.startsWith('/reset-password')) return;

    const { type } = readRecoveryParams(window.location.href);
    if (type === 'recovery') {
      // Single-owner claim shared with the auth provider: whichever side claims first
      // owns the navigation and the other does nothing, regardless of timing. Either
      // way the hint is already (or about to be) written for the reset screen to read.
      if (claimRecoveryRedirect()) {
        window.location.replace(
          `/reset-password${window.location.search}${window.location.hash}`
        );
      } else {
        // The provider claimed it; stay put and let its navigation run. Clearing the
        // URL here is not our job — the provider's redirect replaces this page.
        return;
      }
    }
  }, []);

  return null;
}
