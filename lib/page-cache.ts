'use client';

/**
 * In-memory cache of the last data each page showed, per student. When a student
 * returns to a page, it renders the cached data immediately and refreshes in the
 * background, so navigation feels instant instead of showing a loader every time.
 * Kept in memory only (never written to disk) and cleared on sign-out.
 */
const store = new Map<string, unknown>();

export function readPageCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function writePageCache<T>(key: string, value: T): void {
  store.set(key, value);
}

export function clearPageCache(): void {
  store.clear();
}
