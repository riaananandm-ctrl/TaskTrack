'use client';

/**
 * The in-app reminder ding. It plays while TaskTrack is open, only for reminders
 * that have just come due, and only when the student has explicitly turned on
 * "Play reminder sound". It never plays before the student has interacted with the
 * page (browsers block that, and so do we), never plays the same reminder twice, and
 * stays silent when the sound preference is off.
 *
 * The ding is synthesised with the Web Audio API, so no audio file needs downloading.
 */

const DINGED_KEY = 'tasktrack-dinged-reminders';
const DING_COOLDOWN_MS = 20_000;

let audioContext: AudioContext | null = null;

/** The browser only allows audio after a real interaction; remember once it happens. */
let unlocked = false;

export function markAudioUnlocked(): void {
  unlocked = true;
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

/** Play one short, soft ding. Returns false when it could not (or should not) play. */
export function playDing(): boolean {
  if (!unlocked) return false;
  const ctx = getContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  // A gentle two-note chime: a higher tone easing down to a lower one.
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.18);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.4);
  return true;
}

function readDinged(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DINGED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDinged(map: Record<string, number>): void {
  try {
    window.localStorage.setItem(DINGED_KEY, JSON.stringify(map));
  } catch {
    // Storage may be blocked; the ding simply may repeat after a reload.
  }
}

/**
 * Play the ding for any reminder that has just come due and has not been dinged
 * before. Every reminder id is remembered so it never rings twice, and a short
 * cooldown stops a burst of reminders producing a burst of sound.
 */
export function dingDueReminders(dueIds: string[]): void {
  if (dueIds.length === 0) return;
  const dinged = readDinged();
  const now = Date.now();

  const fresh = dueIds.filter((id) => !dinged[id]);
  if (fresh.length === 0) return;

  const lastEntry = Object.values(dinged).sort((a, b) => b - a)[0] ?? 0;
  if (now - lastEntry < DING_COOLDOWN_MS) {
    // Within the cooldown: remember these so they do not ring on the next check.
    fresh.forEach((id) => { dinged[id] = now; });
    writeDinged(dinged);
    return;
  }

  if (playDing()) {
    fresh.forEach((id) => { dinged[id] = now; });
    writeDinged(dinged);
  }
}

/** Drop ids older than a day so the remembered list cannot grow without bound. */
export function pruneDinged(): void {
  const dinged = readDinged();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, at] of Object.entries(dinged)) {
    if (at < cutoff) {
      delete dinged[id];
      changed = true;
    }
  }
  if (changed) writeDinged(dinged);
}
