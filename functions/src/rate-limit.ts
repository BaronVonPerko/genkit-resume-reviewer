import { HttpsError } from 'firebase-functions/https';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface AttemptWindow {
  windowStartMs: number;
  count: number;
}

// An in-memory counter is enough because maxInstances stays at 2; a multi-instance deployment would store the counter in Firestore or Memorystore.
const attemptsByUid = new Map<string, AttemptWindow>();

let currentTimeMs: () => number = () => Date.now();

/**
 * Counts one review attempt for a signed-in user.
 * Throws on the 6th attempt inside the current 10-minute window.
 */
export function enforceReviewRateLimit(uid: string): void {
  const now = currentTimeMs();
  const existing = attemptsByUid.get(uid);
  if (!existing || now - existing.windowStartMs >= WINDOW_MS) {
    attemptsByUid.set(uid, { windowStartMs: now, count: 1 });
    return;
  }
  if (existing.count >= MAX_ATTEMPTS) {
    throw new HttpsError(
      'resource-exhausted',
      'Rate limit exceeded: 5 review attempts per 10 minutes.',
    );
  }
  attemptsByUid.set(uid, {
    windowStartMs: existing.windowStartMs,
    count: existing.count + 1,
  });
}

/** Clears buckets and optionally replaces the clock. Production uses Date.now. */
export function resetReviewRateLimit(now: () => number = () => Date.now()): void {
  attemptsByUid.clear();
  currentTimeMs = now;
}
