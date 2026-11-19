'use client';

import { useEffect, useState } from 'react';

/**
 * Which videos the student has already watched, so a video plan can show ticks,
 * "3 of 8 watched" and "Continue with Video 4". Kept on this device only; if storage
 * is blocked everything still works, it just starts unticked.
 */

const KEY = 'tasktrack.watchedVideos';
const EVENT = 'tasktrack:watched-videos';
const MAX_KEPT = 500;

export function videoKey(search: string): string {
  return search.replace(/\s+/g, ' ').trim().toLowerCase();
}

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_KEPT)));
  } catch {
    // storage blocked: keep going without saving
  }
  window.dispatchEvent(new Event(EVENT));
}

export function setVideoWatched(search: string, watched: boolean) {
  const key = videoKey(search);
  if (!key) return;
  const list = read().filter((k) => k !== key);
  if (watched) list.push(key);
  write(list);
}

/** The set of watched video keys, kept in step across every view on the page. */
export function useWatchedVideos(): Set<string> {
  const [watched, setWatched] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const sync = () => setWatched(new Set(read()));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return watched;
}
