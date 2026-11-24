import { describe, expect, test } from 'vitest';
import { initialsOf, cleanName } from '@/lib/initials';
import { isValidTimeZone, timeZoneOptions } from '@/lib/time-zones';

describe('avatar initials', () => {
  test('keep whole emoji and non-Latin letters', () => {
    expect(initialsOf('🔥 Riya')).toBe('🔥R');
    expect(initialsOf('👨‍👩‍👧 Fam')).toBe('👨‍👩‍👧F');
    expect(initialsOf('محمد علي')).toBe('مع');
  });
  test('ignore extra spaces and fall back to email', () => {
    expect(initialsOf('  alex   chen ')).toBe('AC');
    expect(initialsOf('   ', 'zed@x.com')).toBe('Z');
    expect(initialsOf(null, null)).toBe('?');
  });
});

describe('names', () => {
  test('blank names become empty and long ones are cut', () => {
    expect(cleanName('    ')).toBe('');
    expect(cleanName('a'.repeat(5000))).toHaveLength(80);
    expect(cleanName('  Alex \n  Chen ')).toBe('Alex Chen');
  });
});

describe('time zones', () => {
  test('only real zones count', () => {
    expect(isValidTimeZone('IST')).toBe(false);
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(timeZoneOptions('Asia/Kolkata')).toContain('Asia/Kolkata');
  });
});
