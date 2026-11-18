'use client';

/**
 * Christmas mode. The code (redeemed in Tools → Redeem Code) unlocks it on the
 * account; this device remembers whether the student switched it off.
 */
export const CHRISTMAS_TOOL = 'christmas';
export const CHRISTMAS_EVENT = 'tasktrack:christmas-changed';
const OFF_KEY = 'tasktrack.christmas.off';

export function christmasSwitchedOff(): boolean {
  try {
    return window.localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setChristmasOn(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(OFF_KEY);
    else window.localStorage.setItem(OFF_KEY, '1');
  } catch {
    // Storage blocked: it still changes for this visit.
  }
  window.dispatchEvent(new CustomEvent(CHRISTMAS_EVENT, { detail: on }));
}
