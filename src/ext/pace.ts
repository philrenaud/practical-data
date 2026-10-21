/**
 * Paces the judge requests that page changes trigger, such as a live score or
 * a ticker that rewrites a cell every second. Changed text misses the answer
 * cache, so without a limit such a page spends model requests without end.
 *
 * Each change-triggered request that sends new table text doubles the wait
 * before the next one, from CHANGE_DELAY_MS up to CHANGE_DELAY_MAX_MS. If no
 * such request is due or sent for CHANGE_RESET_MS past the current wait, the
 * wait starts over. Scrolling a new table into view and the user's own
 * actions are not paced.
 */

/** The first wait after a change. It also batches the mutations of one update. */
export const CHANGE_DELAY_MS = 600;
/** The longest wait between change-triggered requests. */
export const CHANGE_DELAY_MAX_MS = 5 * 60_000;
/** A quiet period after which the wait starts over. */
export const CHANGE_RESET_MS = 60_000;

/** The pacing state: the current wait, and when the last change-triggered request was sent. */
export interface Pace {
  readonly delay: number;
  readonly last: number;
}

export const PACE_START: Pace = { delay: CHANGE_DELAY_MS, last: -Infinity };

const current = (p: Pace, now: number): number =>
  now - p.last > p.delay + CHANGE_RESET_MS ? CHANGE_DELAY_MS : p.delay;

/** Returns the time to wait, from `now`, before a change-triggered request may run. */
export const waitFor = (p: Pace, now: number): number => Math.max(CHANGE_DELAY_MS, p.last + current(p, now) - now);

/** Returns the pacing state after a change-triggered request sent new table text at `now`. */
export const afterSend = (p: Pace, now: number): Pace => ({
  delay: Math.min(current(p, now) * 2, CHANGE_DELAY_MAX_MS),
  last: now,
});
