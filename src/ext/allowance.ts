/**
 * Helpers for the free-endpoint allowance shown in the popup. They merge the
 * reported counts, compute the reset time, and build the popup's messages.
 *
 * The endpoint counts model requests, but the popup shows pages. Pages in the
 * eval set take a median of 12 requests each, so the popup divides by
 * REQUESTS_PER_PAGE, rounds, and says "about".
 */
import type { Allowance } from "../decide/model.ts";

/** The median number of model requests per page in the eval set. */
export const REQUESTS_PER_PAGE = 12;
/** The popup says how much is left when less than this share of the day's allowance remains. */
const LOW_SHARE = 0.2;

/** The last allowance the endpoint reported, and the UTC day it applies to. */
export interface StoredAllowance extends Allowance {
  readonly day: string;
}

/** Returns the UTC date of `now` as YYYY-MM-DD. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/** Returns the next UTC midnight as a local time, such as "8:00 PM". */
export const resetTime = (now: Date, locale?: string): string => {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return reset.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
};

/**
 * Returns the allowance to store, keeping the lowest count reported today.
 * Responses to one page's requests arrive out of order, so a later, higher
 * count is stale. A new UTC day or a new limit starts over.
 */
export const mergeAllowance = (
  stored: StoredAllowance | undefined,
  reported: Allowance,
  now: Date,
): StoredAllowance => {
  const day = utcDay(now);
  if (stored === undefined || stored.day !== day || stored.limit !== reported.limit) return { ...reported, day };
  return { ...reported, remaining: Math.min(stored.remaining, reported.remaining), day };
};

/** Returns the popup's message for a page that was not shaded because the allowance is spent. */
export const quotaMessage = (reason: "quota" | "quota_everyone", now: Date, locale?: string): string =>
  reason === "quota"
    ? `You've used today's free allowance. It resets at ${resetTime(now, locale)}; add your own key in Options for unlimited use.`
    : `Today's free allowance is used up for everyone. It resets at ${resetTime(now, locale)}; add your own key in Options for unlimited use.`;

/**
 * Returns the popup's note when little of today's allowance is left. Returns
 * null otherwise, and when the stored count is from an earlier day.
 */
export const lowAllowanceNote = (stored: StoredAllowance | undefined, now: Date): string | null => {
  if (stored === undefined || stored.day !== utcDay(now)) return null;
  if (stored.remaining <= 0 || stored.remaining / stored.limit >= LOW_SHARE) return null;
  const pages = Math.round(stored.remaining / REQUESTS_PER_PAGE);
  const amount = pages <= 1 ? "About a page" : `About ${pages} pages`;
  return `${amount} of free use left today. Add your own key in Options for unlimited use.`;
};
