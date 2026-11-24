import { beforeEach, describe, expect, test, vi } from 'vitest';
import { captureSignupRef, cleanRef, reportSignupRef, storedSignupRef } from '@/lib/signup-ref';

// node environment: a tiny localStorage stand-in.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

beforeEach(() => store.clear());

describe('signup ref', () => {
  test('accepts short lowercase tags only', () => {
    expect(cleanRef('Meta')).toBe('meta');
    expect(cleanRef(' poster ')).toBe('poster');
    expect(cleanRef('ig_reel-2')).toBe('ig_reel-2');
    expect(cleanRef('')).toBeNull();
    expect(cleanRef('<script>')).toBeNull();
    expect(cleanRef('x'.repeat(33))).toBeNull();
  });

  test('keeps the newest ref for 7 days', () => {
    captureSignupRef('?ref=poster', 1000);
    captureSignupRef('?utm=x', 2000); // no ref: keeps the old one
    expect(storedSignupRef(3000)).toBe('poster');
    captureSignupRef('?ref=meta', 4000);
    expect(storedSignupRef(5000)).toBe('meta');
    expect(storedSignupRef(4000 + 8 * 24 * 3600 * 1000)).toBeNull();
  });

  test('reports once, then forgets', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    captureSignupRef('?ref=meta');
    await reportSignupRef({ rpc } as never);
    await reportSignupRef({ rpc } as never);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_signup_ref', { p_ref: 'meta' });
  });

  test('does nothing without a ref', async () => {
    const rpc = vi.fn();
    await reportSignupRef({ rpc } as never);
    expect(rpc).not.toHaveBeenCalled();
  });
});
