/**
 * Injectable clock — a single seam for all time-related decisions.
 *
 * Route every schedule, cutoff, "today", expiry, and late/on-time decision
 * through `clock.now()` instead of calling `new Date()` / `Date.now()` inline.
 * Override in tests to drive time-based behavior deterministically.
 */

export interface Clock {
  now(): Date;
  nowMs(): number;
}

/** Real system clock (default). */
export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};
