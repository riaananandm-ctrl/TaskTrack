import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

import { inviteLink, inviteMessage } from '@/lib/invite';
import { cleanRef } from '@/lib/signup-ref';

describe('invite links', () => {
  test('use the i- ref that sign-up tracking keeps', () => {
    const link = inviteLink('https://tasktrackbm.vercel.app/', 'jagtma9');
    expect(link).toBe('https://tasktrackbm.vercel.app/?ref=i-jagtma9');
    // The ref has to survive cleanRef, or the reward would never be reported.
    expect(cleanRef(new URL(link).searchParams.get('ref'))).toBe('i-jagtma9');
  });

  test('the message says what both people get and includes the link', () => {
    const msg = inviteMessage('https://x.app/?ref=i-abc', 50);
    expect(msg).toContain('50 extra AI credits');
    expect(msg).toContain('https://x.app/?ref=i-abc');
  });
});
